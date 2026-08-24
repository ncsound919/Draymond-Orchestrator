/**
 * Workflow budget — token flow + rate protection + task-lane freezing.
 *
 * Prevents API feeds from being over-hit and stops unnecessary calls:
 *   - Token budgets per provider (daily cap) + consumed tracking.
 *   - Rolling rate windows (calls/min) to avoid 429s.
 *   - Per-operation cooldowns so repeated/duplicate calls are skipped.
 *   - Task lanes per agent: when an agent's in-flight count is at capacity,
 *     its lane is FROZEN until something opens (no new tasks assigned).
 *
 * Deterministic + in-memory (state resets on restart; budgets are conservative).
 */

interface AgentLane {
  maxConcurrency: number;
  inFlight: number;
  frozen: boolean;
}

const PROVIDER_DAILY_BUDGETS: Record<string, number> = {
  'ox-alpha': 800_000,        // ecosystem primary — Ox Alpha free (zen/v1)
  'opencode-free': 800_000,   // alias of ox-alpha (same zen/v1 tier, shared quota)
  opencode: 500_000,          // Go tier — fallback only
  deepseek: 1_000_000,        // first fallback (api.deepseek.com)
  'deepseek-direct': 1_000_000,
  dsh: 800_000,               // DSH harness gateway (ox-alpha via harness seam)
  gemini: 1_000_000,
  openai: 1_000_000,
  anthropic: 1_000_000,
  qwen: 500_000,
  litellm: 2_000_000,
};

const DEFAULT_MAX_CONCURRENCY = 2;
const RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 20;

const providerTokens: Record<string, { used: number; day: string }> = {};
const rateCalls: Record<string, number[]> = {}; // provider -> timestamps
const cooldowns = new Map<string, number>(); // `${agent}:${op}` -> expiresAt
const lanes = new Map<string, AgentLane>();

/** Fleet-wide daily token cap — the whole ecosystem stays under this. */
function fleetDailyBudget(): number {
  const raw = Number(process.env.DRAYMOND_FLEET_DAILY_BUDGET ?? 5_000_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000_000;
}

let fleetTokens = 0;
let fleetDay = '';

function ensureFleetDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (fleetDay !== today) {
    fleetDay = today;
    fleetTokens = 0;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function providerBudget(provider: string): number {
  return PROVIDER_DAILY_BUDGETS[provider] ?? 500_000;
}

/** Remaining fleet-wide daily token budget. */
export function fleetBudgetRemaining(): number {
  ensureFleetDay();
  return Math.max(0, fleetDailyBudget() - fleetTokens);
}

/** Reserve + record fleet-wide token consumption (cap enforced in consumeTokens). */
export function consumeFleetTokens(tokens: number): void {
  ensureFleetDay();
  fleetTokens += Math.max(0, tokens);
}

/** True if the fleet still has budget for an estimated call size. */
export function canCallFleet(tokens = 1024): { ok: boolean; reason?: string } {
  ensureFleetDay();
  const projected = fleetTokens + Math.max(0, tokens);
  if (projected >= fleetDailyBudget()) {
    return { ok: false, reason: `fleet budget exhausted (${fleetTokens}/${fleetDailyBudget()})` };
  }
  return { ok: true };
}

/** True if this provider still has budget + isn't rate-limited. */
export function canCallProvider(provider: string): { ok: boolean; reason?: string } {
  ensureFleetDay();
  if (fleetTokens >= fleetDailyBudget()) {
    return { ok: false, reason: `fleet budget exhausted (${fleetTokens}/${fleetDailyBudget()})` };
  }
  const entry = providerTokens[provider] ?? (providerTokens[provider] = { used: 0, day: today() });
  if (entry.day !== today()) {
    entry.day = today();
    entry.used = 0;
  }
  if (entry.used >= providerBudget(provider)) {
    return { ok: false, reason: `provider "${provider}" budget exhausted (${entry.used}/${providerBudget(provider)})` };
  }
  const window = rateCalls[provider] ?? (rateCalls[provider] = []);
  const now = Date.now();
  while (window.length && window[0]! < now - RATE_WINDOW_MS) window.shift();
  if (window.length >= DEFAULT_RATE_LIMIT_PER_MIN) {
    return { ok: false, reason: `provider "${provider}" rate-limited (${window.length}/min)` };
  }
  return { ok: true };
}

/** Reserve + record a provider call (call AFTER success to count real usage). */
export function consumeTokens(provider: string, tokens: number): void {
  const entry = providerTokens[provider] ?? (providerTokens[provider] = { used: 0, day: today() });
  if (entry.day !== today()) {
    entry.day = today();
    entry.used = 0;
  }
  entry.used += Math.max(0, tokens);
  const window = rateCalls[provider] ?? (rateCalls[provider] = []);
  window.push(Date.now());
  // Every provider token also counts toward the fleet cap.
  consumeFleetTokens(tokens);
  // Metering rail (fail-soft, fire-and-forget): emit a usage event to the
  // Tap919 Middleman so every LLM call becomes billable Stripe meter input.
  if (process.env.MIDDLEMAN_URL) {
    void import('./meter').then(({ meterProviderCall }) =>
      meterProviderCall(provider, tokens)
    ).catch(() => undefined);
  }
}

/** Cooldown: skip a repeated op within the window (e.g. don't re-run QA every minute). */
export function isOnCooldown(agentId: string, op: string, cooldownMs: number): boolean {
  const key = `${agentId}:${op}`;
  const until = cooldowns.get(key) ?? 0;
  if (Date.now() < until) return true;
  cooldowns.set(key, Date.now() + cooldownMs);
  return false;
}

// ── Task lanes (plate-full freezing) ────────────────────────────────────────

function laneOf(agentId: string, maxConcurrency: number): AgentLane {
  let lane = lanes.get(agentId);
  if (!lane) {
    lane = { maxConcurrency, inFlight: 0, frozen: false };
    lanes.set(agentId, lane);
  }
  return lane;
}

/** Is the agent's task lane open (can take more work)? */
export function laneStatus(agentId: string, maxConcurrency = DEFAULT_MAX_CONCURRENCY): { open: boolean; inFlight: number; max: number; frozen: boolean } {
  const lane = laneOf(agentId, maxConcurrency);
  lane.frozen = lane.inFlight >= lane.maxConcurrency;
  return { open: !lane.frozen, inFlight: lane.inFlight, max: lane.maxConcurrency, frozen: lane.frozen };
}

/** Try to acquire a task slot. Returns false if the lane is full (frozen). */
export function acquireLane(agentId: string, maxConcurrency = DEFAULT_MAX_CONCURRENCY): boolean {
  const lane = laneOf(agentId, maxConcurrency);
  if (lane.inFlight >= lane.maxConcurrency) {
    lane.frozen = true;
    return false;
  }
  lane.inFlight += 1;
  lane.frozen = false;
  return true;
}

/** Release a slot when a task finishes — opens the lane. */
export function releaseLane(agentId: string): void {
  const lane = lanes.get(agentId);
  if (lane) {
    lane.inFlight = Math.max(0, lane.inFlight - 1);
    lane.frozen = lane.inFlight >= lane.maxConcurrency;
  }
}

export function laneSnapshot(): Record<string, { open: boolean; inFlight: number; max: number }> {
  const out: Record<string, { open: boolean; inFlight: number; max: number }> = {};
  for (const [id, lane] of lanes.entries()) {
    out[id] = { open: lane.inFlight < lane.maxConcurrency, inFlight: lane.inFlight, max: lane.maxConcurrency };
  }
  return out;
}

/** Reset all budgets/lanes (tests, day rollover). */
export function resetBudget(): void {
  for (const k of Object.keys(providerTokens)) delete providerTokens[k];
  for (const k of Object.keys(rateCalls)) delete rateCalls[k];
  cooldowns.clear();
  lanes.clear();
  fleetTokens = 0;
  fleetDay = '';
}
