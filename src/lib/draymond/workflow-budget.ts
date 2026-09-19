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
 * Deterministic. Cooldowns are DURABLE (persisted under the registry dir) so a
 * restart cannot re-dispatch/re-notify the same op — the in-memory version was
 * wiped on every process bounce and was a root cause of duplicate repair
 * emails. Token budgets + lanes stay in-memory and conservative.
 */

import fs from 'node:fs';
import path from 'node:path';

interface AgentLane {
  maxConcurrency: number;
  inFlight: number;
  frozen: boolean;
}

const PROVIDER_DAILY_BUDGETS: Record<string, number> = {
  'opencode-free': 800_000,       // Zen free tier — account pool shares this quota
  openrouter: 800_000,            // OpenRouter free (:free) tier
  opencode: 500_000,              // Go tier — fallback only
  deepseek: 1_000_000,            // first paid fallback (api.deepseek.com)
  'deepseek-direct': 1_000_000,
  dsh: 800_000,                   // DSH harness gateway (free tier via harness seam)
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

/** Durable cooldown store — survives restarts so repairs/notifications can't
 *  re-fire identical work just because the process bounced. */
const COOLDOWN_FILE = (): string =>
  path.join(process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'), 'cooldowns.json');

let cooldownsLoaded = false;

function loadCooldowns(): void {
  if (cooldownsLoaded) return;
  cooldownsLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(COOLDOWN_FILE(), 'utf-8')) as Record<string, number>;
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && v > now) cooldowns.set(k, v);
    }
  } catch {
    /* no cooldown file yet — start clean */
  }
}

function persistCooldowns(): void {
  try {
    const now = Date.now();
    const obj: Record<string, number> = {};
    for (const [k, v] of cooldowns) if (v > now) obj[k] = v;
    fs.mkdirSync(path.dirname(COOLDOWN_FILE()), { recursive: true });
    fs.writeFileSync(COOLDOWN_FILE(), JSON.stringify(obj, null, 2));
  } catch {
    /* best-effort — cooldowns are a guard rail, not a correctness requirement */
  }
}

/** Cooldown: skip a repeated op within the window (e.g. don't re-run QA every minute).
 *  Records the cooldown on first call (check-and-set) and persists it. */
export function isOnCooldown(agentId: string, op: string, cooldownMs: number): boolean {
  loadCooldowns();
  const key = `${agentId}:${op}`;
  const now = Date.now();
  const until = cooldowns.get(key) ?? 0;
  if (now < until) return true;
  cooldowns.set(key, now + cooldownMs);
  persistCooldowns();
  return false;
}

// -- Task lanes (plate-full freezing) ----------------------------------------

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
  persistCooldowns();
  lanes.clear();
  fleetTokens = 0;
  fleetDay = '';
}

// -- S4 Budget Engine ---------------------------------------------------------
//
// Per-task model assignment based on treasury balance, system-goals weights,
// and the free catalog mapping. Invariant: revenueCents === 0 means free/ollama
// only — never assign the Go (paid) tier when treasury is empty.
//
// IMPORTANT: treasury.json is Treasurer-owned. This module READS it only; it
// NEVER writes. Only treasury.ts / treasury-state.ts may write that file.

import { readFileSync as _readFileSync, existsSync as _existsSync } from 'node:fs';
import { join as _join } from 'node:path';

export type ModelTier = 'free' | 'go' | 'ollama';

export interface AssignedModel {
  provider: string;
  model: string;
  tier: ModelTier;
}

const TIER_DEFAULTS: Record<ModelTier, AssignedModel> = {
  free:   { provider: 'opencode-free', model: 'muse-spark-1.2-contributor-free', tier: 'free' },
  go:     { provider: 'opencode',  model: 'deepseek-v4-flash', tier: 'go'    },
  ollama: { provider: 'ollama',    model: 'qwen3:0.6b',        tier: 'ollama' },
};

/**
 * Read the current treasury balance in revenue cents (READ-ONLY).
 * Returns 0 when the file is absent or unreadable — defaults to all-free path.
 * IMPORTANT: Do NOT write to treasury.json here. Treasurer role owns all writes.
 */
export function readTreasuryBalance(): number {
  try {
    const registryDir =
      process.env.DRAYMOND_REGISTRY_DIR ?? _join(process.cwd(), '.draymond');
    const p = _join(registryDir, 'treasury.json');
    if (!_existsSync(p)) return 0;
    const data = JSON.parse(_readFileSync(p, 'utf8')) as { revenueCents?: number };
    return typeof data.revenueCents === 'number' ? Math.max(0, data.revenueCents) : 0;
  } catch {
    return 0;
  }
}

/**
 * Read the daily-assigned free model from model-routing.json.
 * Falls back to the bootstrap default when the file is absent or sync hasn't run.
 */
function readAssignedFreeModel(): string {
  const fallback = 'muse-spark-1.2-contributor-free';
  try {
    const registryDir =
      process.env.DRAYMOND_REGISTRY_DIR ?? _join(process.cwd(), '.draymond');
    const p = _join(registryDir, 'model-routing.json');
    if (!_existsSync(p)) return process.env.ASSIGNED_FREE_MODEL || fallback;
    const data = JSON.parse(_readFileSync(p, 'utf8')) as { assignedFreeModel?: string };
    return process.env.ASSIGNED_FREE_MODEL || (typeof data.assignedFreeModel === 'string' ? data.assignedFreeModel : fallback);
  } catch {
    return process.env.ASSIGNED_FREE_MODEL || fallback;
  }
}

/**
 * Assign a model tier for a task, respecting budget and skill tier.
 *
 * Invariants enforced:
 *   - treasury.revenueCents === 0 → tier is 'free' or 'ollama', NEVER 'go'.
 *   - BUDGET_AWARE_ROUTING=0 → always return static free-tier default (feature flag).
 *   - Go tier only when revenue > GO_TIER_MIN_CENTS AND task is 'critical' priority.
 *   - Local-only skill tiers (vision/biomed/ocr/chem/fast) always go to Ollama.
 *
 * @param taskId    Human-readable task identifier (for logging only).
 * @param skillTier From skill-model-map.json tier field.
 * @param priority  Optional task priority hint.
 */
export function assignModelForTask(
  taskId: string,
  skillTier: 'fast' | 'code' | 'vision' | 'biomed' | 'ocr' | 'chem' | string = 'code',
  priority: 'normal' | 'critical' = 'normal',
): AssignedModel {
  // Feature flag — fall back to static free-tier chain
  if (process.env.BUDGET_AWARE_ROUTING === '0') {
    return { ...TIER_DEFAULTS.free, model: readAssignedFreeModel() };
  }

  // Local-only skills always route to Ollama regardless of budget
  const ollamaSkills = new Set(['vision', 'biomed', 'ocr', 'chem', 'fast']);
  if (ollamaSkills.has(skillTier)) {
    const ollamaModels: Record<string, string> = {
      vision: process.env.OLLAMA_VISION_MODEL ?? 'qwen3.5:4b',
      biomed: 'medgemma:4b',
      ocr:    'deepseek-ocr:3b',
      chem:   'txgemma-2b',
      fast:   'qwen3:0.6b',
    };
    const model = ollamaModels[skillTier] ?? 'qwen3:0.6b';
    _assignmentCounts.ollama += 1;
    return { provider: 'ollama', model, tier: 'ollama' };
  }

  // Code / general tasks: treasury gates Go-tier access
  const revenueCents = readTreasuryBalance();
  const GO_TIER_MIN_CENTS = Number(process.env.GO_TIER_MIN_CENTS ?? 500);
  const goAllowed = revenueCents > GO_TIER_MIN_CENTS && priority === 'critical';

  if (goAllowed) {
    console.info(`[budget] task=${taskId} tier=go (revenue=${revenueCents}¢, priority=${priority})`);
    _assignmentCounts.go += 1;
    return { ...TIER_DEFAULTS.go };
  }

  const assignedFree = readAssignedFreeModel();
  console.info(`[budget] task=${taskId} tier=free model=${assignedFree} (revenue=${revenueCents}¢)`);
  _assignmentCounts.free += 1;
  return { provider: 'opencode-free', model: assignedFree, tier: 'free' };
}

// Counters for Prometheus gauges (read by metrics.ts; reset on process restart)
const _assignmentCounts: Record<ModelTier, number> = { free: 0, go: 0, ollama: 0 };

/** Snapshot assignment counts for metrics scrape (never mutates). */
export function getAssignmentCounts(): Readonly<Record<ModelTier, number>> {
  return { ..._assignmentCounts };
}
