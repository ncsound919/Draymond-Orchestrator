/**
 * Kairos — always-on proactive daemon.
 *
 * Polls fleet state on a 5-minute tick (catch-up scan on start) and surfaces
 * *kairos moments*: deterministic detector output, deduped by hash, capped at
 * KAIROS_CAP entries. Critical moments push to ntfy; an optional daily digest
 * email lists un-acked moments. All writes are best-effort / fail-soft — a
 * detector that throws (or whose module drifted away) degrades to a captured
 * error in the scan report instead of killing the daemon.
 */

import { readJsonState, writeJsonState, nowIso, uid } from './cognition';
import { logEvent } from './index';
import type { EventCategory, EventSeverity } from './types';

export type KairosSeverity = 'info' | 'warn' | 'critical';

export const KAIROS_KINDS = [
  'monitor_down',
  'job_failed',
  'stale_lead',
  'revenue_shortfall',
  'budget_pressure',
  'weak_agent',
  'repair_loop',
  'stale_heartbeat',
  'stale_experiment',
  'memory_pressure',
  'cost_pressure',
] as const;
export type KairosKind = (typeof KAIROS_KINDS)[number];

export interface KairosMoment {
  id: string; // km_<ts>_<rand>
  kind: KairosKind;
  severity: KairosSeverity;
  title: string;
  detail: string;
  source: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  hash: string;
  acked: boolean;
}

export interface KairosState {
  moments: KairosMoment[];
  settings: { lastDigestAt?: string };
  updatedAt: string;
}

export interface DetectorHit {
  kind: KairosKind;
  severity: KairosSeverity;
  title: string;
  detail: string;
  source: string;
}

// ============================================================================
// CONFIG (env, read per call so tests can flip values without re-import)
// ============================================================================

function tickMs(): number {
  return Math.max(1000, Number(process.env.KAIROS_TICK_MS ?? 300_000));
}
function tickBudgetMs(): number {
  return Math.max(1, Number(process.env.KAIROS_TICK_BUDGET_MS ?? 15_000));
}
function repeatNotifyHours(): number {
  return Math.max(1, Number(process.env.KAIROS_REPEAT_NOTIFY_HOURS ?? 24));
}
function cap(): number {
  return Math.max(10, Number(process.env.KAIROS_CAP ?? 200));
}

const HEARTBEAT_STALE_MS = 30 * 60_000;
const LEAD_STALE_DAYS = 14;
const WEAK_AGENT_SCORE_FLOOR = 0.6;

function DEFAULT_STATE(): KairosState {
  return { moments: [], settings: {}, updatedAt: nowIso() };
}

// ============================================================================
// DETECTORS — deterministic rules, no LLM in the hot path. Each one
// lazy-imports its data source inside its own body so a drifted/missing module
// fails one detector, not the daemon.
// ============================================================================

export async function detectMonitorDown(): Promise<DetectorHit[]> {
  const { checkAllSites } = await import('./monitors');
  const r = await checkAllSites();
  return r.results
    .filter((s) => !s.is_up)
    .map((s) => ({
      kind: 'monitor_down' as const,
      severity: 'critical' as const,
      title: `Site down: ${s.monitor_name}`,
      detail: `${s.url} — ${s.status_code ?? 'no response'}${s.consecutive_failures > 1 ? ` (${s.consecutive_failures}x)` : ''}`,
      source: 'monitors',
    }));
}

export async function detectJobFailed(): Promise<DetectorHit[]> {
  const { listJobs } = await import('./scheduler');
  const jobs = await listJobs({ last_run_status: 'failed', limit: 20 });
  return jobs.map((j) => ({
    kind: 'job_failed' as const,
    severity: 'warn' as const,
    title: `Job failed: ${j.name}`,
    detail: j.last_error ?? `failed after ${j.fail_count ?? 0} failures`,
    source: 'scheduler',
  }));
}

export async function detectStaleLead(): Promise<DetectorHit[]> {
  const { listOpportunities } = await import('./business-pipeline');
  const ops = await listOpportunities();
  const cutoff = Date.now() - LEAD_STALE_DAYS * 86_400_000;
  return ops
    .filter((o) => o.stage === 'lead' && new Date(o.updatedAt).getTime() < cutoff)
    .map((o) => ({
      kind: 'stale_lead' as const,
      severity: 'warn' as const,
      title: `Stale lead: ${o.name}`,
      detail: `lead for ${Math.round((Date.now() - new Date(o.updatedAt).getTime()) / 86_400_000)} days`,
      source: 'business-pipeline',
    }));
}

export async function detectRevenueShortfall(): Promise<DetectorHit[]> {
  const { settledRevenueUsd } = await import('./treasury-state');
  const { readStrategy, totalMonthlyTarget } = await import('./mission-strategy');
  const [revenue, strategy] = await Promise.all([settledRevenueUsd(), readStrategy()]);
  const target = totalMonthlyTarget(strategy);
  // Drift guard: a degraded/missing source yields NaN/undefined — treat as
  // "no signal", never as a $NaN shortfall moment.
  if (!Number.isFinite(target) || target <= 0) return [];
  if (!Number.isFinite(revenue) || revenue >= target) return [];
  const shortfall = target - revenue;
  return [
    {
      kind: 'revenue_shortfall' as const,
      severity: shortfall > target * 0.25 ? ('warn' as const) : ('info' as const),
      title: `Revenue shortfall: $${shortfall}`,
      detail: `$${revenue} settled vs $${target} monthly target`,
      source: 'mission',
    },
  ];
}

export async function detectBudgetPressure(): Promise<DetectorHit[]> {
  const { canCallProvider, providerBudget } = await import('./workflow-budget');
  const { buildProviderOrder } = await import('./llm');
  const hits: DetectorHit[] = [];
  for (const p of buildProviderOrder()) {
    const gate = canCallProvider(p);
    if (!gate.ok) {
      hits.push({
        kind: 'budget_pressure' as const,
        severity: 'warn' as const,
        title: `Provider budget pressure: ${p}`,
        detail: gate.reason ?? `budget exhausted (${providerBudget(p)} tokens/day)`,
        source: 'workflow-budget',
      });
    }
  }
  return hits;
}

export async function detectWeakAgent(): Promise<DetectorHit[]> {
  const { listUpgradeQueue, failoverActionFor } = await import('./upgrade-queue');
  const queued = await listUpgradeQueue('queued');
  const top = [...queued].sort((a, b) => b.weakness_score - a.weakness_score)[0];
  if (!top || top.weakness_score < WEAK_AGENT_SCORE_FLOOR) return [];
  const matrix = failoverActionFor(top.weakness_score, top.component_class, top.reasons);
  return [
    {
      kind: 'weak_agent' as const,
      severity: 'warn' as const,
      title: `Weakest agent: ${top.component_name}`,
      detail: `${top.component_class} ${top.component_slug} — weakness ${top.weakness_score.toFixed(2)} · ${matrix.action}${top.proposed_action ? ` (queue: ${top.proposed_action})` : ''}`,
      source: 'upgrade-queue',
    },
  ];
}

export async function detectRepairLoop(): Promise<DetectorHit[]> {
  const { detectRepairLoops } = await import('./self-repair');
  const loops = await detectRepairLoops(10);
  return loops
    .filter((l) => l.action === 'escalated')
    .map((l) => ({
      kind: 'repair_loop' as const,
      severity: 'critical' as const,
      title: `Blind repair loop: ${l.signal}`,
      detail: `${l.attempts} attempts in ${l.window.from}…${l.window.to} — escalated`,
      source: 'self-repair',
    }));
}

export async function detectStaleHeartbeat(): Promise<DetectorHit[]> {
  const { getHeartbeats } = await import('./heartbeat');
  const hbs = await getHeartbeats();
  const cutoff = Date.now() - HEARTBEAT_STALE_MS;
  const hits: DetectorHit[] = [];
  for (const rec of Object.values(hbs)) {
    const seen = new Date(rec.last_seen).getTime();
    if (!rec.up || seen < cutoff) {
      hits.push({
        kind: 'stale_heartbeat' as const,
        severity: 'warn' as const,
        title: `Agent heartbeat stale: ${rec.name}`,
        detail: `${rec.up ? 'stale' : 'down'} — last seen ${Math.max(1, Math.round((Date.now() - seen) / 60_000))}m ago${rec.detail ? ` (${rec.detail})` : ''}`,
        source: 'heartbeats',
      });
    }
  }
  return hits;
}

/** Flag experiments stuck in 'queued' or 'running' beyond the stale window. */
export async function detectStaleExperiment(): Promise<DetectorHit[]> {
  const { listExperiments } = await import('@/lib/science/experiments');
  const experiments = await listExperiments();
  const staleHours = Math.max(1, Number(process.env.SCIENCE_STALE_EXPERIMENT_HOURS ?? 24));
  const cutoff = Date.now() - staleHours * 3_600_000;
  const hits: DetectorHit[] = [];
  for (const exp of experiments) {
    if (exp.status !== 'queued' && exp.status !== 'running') continue;
    const updated = new Date(exp.updated_at).getTime();
    if (Number.isNaN(updated) || updated >= cutoff) continue;
    hits.push({
      kind: 'stale_experiment' as const,
      severity: 'warn' as const,
      title: `Stale experiment: ${exp.experiment_id}`,
      detail: `${exp.type}/${exp.domain} stuck ${exp.status} for ${Math.max(1, Math.round((Date.now() - updated) / 3_600_000))}h (${exp.goal_id})`,
      source: 'science',
    });
  }
  return hits;
}

export async function detectMemoryPressure(): Promise<DetectorHit[]> {
  const { checkBrainStateBudget } = await import('./memory-intelligence');
  const over = (await checkBrainStateBudget()).filter((f) => f.overBudget);
  return over.map((f) => ({
    kind: 'memory_pressure' as const,
    severity: 'warn' as const,
    title: `Brain-state over budget: ${f.file}`,
    detail: `${f.file} is ${Math.round(f.sizeBytes / 1024)}KB vs ${Math.round(f.capBytes / 1024)}KB cap — run a consolidation (rethink) pass.`,
    source: 'memory-intelligence',
  }));
}

export async function detectCostPressure(): Promise<DetectorHit[]> {
  const capCents = Number(process.env.DRAYMOND_DAILY_COST_CAP_CENTS ?? 5000); // $50/day
  if (!Number.isFinite(capCents) || capCents <= 0) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { getCostSummary } = await import('./analytics');
  const summary = await getCostSummary(since).catch(() => null);
  if (!summary || summary.total_cents < capCents) return [];
  return [
    {
      kind: 'cost_pressure' as const,
      severity: 'warn' as const,
      title: `Fleet cost over $${(capCents / 100).toFixed(2)}/day`,
      detail: `Last 24h cost $${(summary.total_cents / 100).toFixed(2)} exceeds cap $${(capCents / 100).toFixed(2)}. Review delegation budgets / provider routing.`,
      source: 'analytics',
    },
  ];
}

export const DETECTORS: Array<{ kind: KairosKind; run: () => Promise<DetectorHit[]> }> = [
  { kind: 'monitor_down', run: detectMonitorDown },
  { kind: 'job_failed', run: detectJobFailed },
  { kind: 'stale_lead', run: detectStaleLead },
  { kind: 'revenue_shortfall', run: detectRevenueShortfall },
  { kind: 'budget_pressure', run: detectBudgetPressure },
  { kind: 'weak_agent', run: detectWeakAgent },
  { kind: 'repair_loop', run: detectRepairLoop },
  { kind: 'stale_heartbeat', run: detectStaleHeartbeat },
  { kind: 'stale_experiment', run: detectStaleExperiment },
  { kind: 'memory_pressure', run: detectMemoryPressure },
  { kind: 'cost_pressure', run: detectCostPressure },
];

// ============================================================================
// MOMENT RECORDING — dedupe, escalation, notify
// ============================================================================

/**
 * Normalize a detector detail for dedupe hashing. Variable fragments that
 * change on every scan — failure counters like "(167x)", relative ages like
 * "last seen 539m ago", overdue minutes, and dollar amounts — are collapsed so
 * the SAME underlying condition produces ONE moment instead of a new moment
 * (and new critical push) every tick.
 */
export function normalizeMomentDetail(detail: string): string {
  return detail
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\d+x\)/g, '(Nx)') // consecutive-failure counters
    .replace(/last seen \d+[smhd] ago/g, 'last seen Na ago') // relative heartbeat ages
    .replace(/overdue by \d+min/g, 'overdue by Nmin') // scheduler miss windows
    .replace(/\$\d+(?:\.\d+)?/g, '$N') // revenue/shortfall amounts
    .trim();
}

/** Dedupe key: kind + normalized detail. */
export function momentHash(kind: string, detail: string): string {
  return `${kind}:${normalizeMomentDetail(detail)}`;
}

const SEVERITY_RANK: Record<KairosSeverity, number> = { info: 0, warn: 1, critical: 2 };

function escalate(severity: KairosSeverity): KairosSeverity {
  return severity === 'info' ? 'warn' : severity === 'warn' ? 'critical' : 'critical';
}

const EVENT_CATEGORY: Record<KairosKind, EventCategory> = {
  monitor_down: 'health',
  job_failed: 'health',
  stale_lead: 'goal',
  revenue_shortfall: 'goal',
  budget_pressure: 'health',
  weak_agent: 'confidence',
  repair_loop: 'recovery',
  stale_heartbeat: 'health',
  stale_experiment: 'goal',
  memory_pressure: 'health',
  cost_pressure: 'goal',
};

const EVENT_SEVERITY: Record<KairosSeverity, EventSeverity> = {
  info: 'info',
  warn: 'warning',
  critical: 'critical',
};

async function notifyMoment(moment: KairosMoment): Promise<void> {
  try {
    const { publishIssueNotification } = await import('./ntfy');
    await publishIssueNotification({
      title: `[Kairos] ${moment.title}`,
      message: moment.detail,
      priority: moment.severity === 'critical' ? 5 : 4,
      tags: [moment.kind],
    });
  } catch {
    // best-effort
  }
}

/** Record one detector hit. Returns whether it was created (vs repeated) and notified. */
async function recordMoment(hit: DetectorHit): Promise<{ created: boolean; notified: boolean }> {
  const state = await readJsonState<KairosState>('kairos', DEFAULT_STATE());
  const hash = momentHash(hit.kind, hit.detail);
  const now = nowIso();
  const existing = state.moments.find((m) => m.hash === hash);

  if (existing) {
    const prevSeverity = existing.severity;
    const prevLastSeen = existing.lastSeen;
    existing.occurrences += 1;
    existing.severity = escalate(existing.severity);
    existing.lastSeen = now;
    await writeJsonState('kairos', state);
    const escalated = existing.severity !== prevSeverity;
    const lastSeenAgo = Date.now() - new Date(prevLastSeen).getTime();
    if (escalated || lastSeenAgo >= repeatNotifyHours() * 3_600_000) {
      await notifyMoment(existing);
      return { created: false, notified: true };
    }
    return { created: false, notified: false };
  }

  const moment: KairosMoment = {
    id: uid('km'),
    kind: hit.kind,
    severity: hit.severity,
    title: hit.title,
    detail: hit.detail,
    source: hit.source,
    firstSeen: now,
    lastSeen: now,
    occurrences: 1,
    hash,
    acked: false,
  };
  state.moments.unshift(moment);
  if (state.moments.length > cap()) state.moments = state.moments.slice(0, cap());
  await writeJsonState('kairos', state);

  // Audit trail for every NEW moment.
  await logEvent({
    agent_id: 'draymond',
    category: EVENT_CATEGORY[hit.kind],
    severity: EVENT_SEVERITY[hit.severity],
    event_type: `kairos_${hit.kind}`,
    message: `[Kairos] ${hit.title} — ${hit.detail}`,
    metadata: { momentId: moment.id, severity: hit.severity },
  }).catch(() => {});

  let notified = false;
  if (hit.severity === 'critical') {
    await notifyMoment(moment);
    notified = true;
  }
  return { created: true, notified };
}

// ============================================================================
// SCAN
// ============================================================================

export interface KairosScanResult {
  detected: number;
  created: number;
  repeated: number;
  notified: number;
  errors: string[];
  budgetExceeded: boolean;
  durationMs: number;
}

/** One detection pass — runs detectors in order within the tick budget. */
export async function kairosScan(): Promise<KairosScanResult> {
  const started = Date.now();
  const hits: DetectorHit[] = [];
  const errors: string[] = [];
  let budgetExceeded = false;
  let completed = 0;

  for (const det of DETECTORS) {
    if (Date.now() - started >= tickBudgetMs()) {
      budgetExceeded = true;
      break;
    }
    try {
      hits.push(...(await det.run()));
    } catch (err) {
      errors.push(`${det.kind}: ${err instanceof Error ? err.message : String(err)}`);
    }
    completed += 1;
  }

  let created = 0;
  let repeated = 0;
  let notified = 0;
  for (const hit of hits) {
    const r = await recordMoment(hit);
    if (r.created) created += 1;
    else repeated += 1;
    if (r.notified) notified += 1;
  }

  if (budgetExceeded) {
    await logEvent({
      agent_id: 'draymond',
      category: 'health',
      severity: 'warning',
      event_type: 'kairos_tick_budget_exceeded',
      message: `Kairos scan exceeded ${tickBudgetMs()}ms budget after ${completed}/${DETECTORS.length} detectors`,
      metadata: { completed, total: DETECTORS.length },
    }).catch(() => {});
  }

  await maybeSendKairosDigest().catch(() => {});

  return {
    detected: hits.length,
    created,
    repeated,
    notified,
    errors,
    budgetExceeded,
    durationMs: Date.now() - started,
  };
}

// ============================================================================
// DIGEST EMAIL
// ============================================================================

/** Optional daily digest of un-acked moments (best-effort, once per 24h). */
export async function maybeSendKairosDigest(): Promise<{ sent: boolean }> {
  const recipient = process.env.KAIROS_DIGEST_EMAIL;
  if (!recipient) return { sent: false };
  const state = await readJsonState<KairosState>('kairos', DEFAULT_STATE());
  const last = state.settings.lastDigestAt;
  if (last && Date.now() - new Date(last).getTime() < 24 * 3_600_000) return { sent: false };

  const unacked = state.moments.filter((m) => !m.acked);
  const { sendAlertEmail } = await import('./notifications');
  const body =
    unacked.length === 0
      ? 'No un-acked kairos moments.'
      : unacked.map((m) => `[${m.severity.toUpperCase()}] ${m.title} — ${m.detail} (x${m.occurrences})`).join('\n');
  await sendAlertEmail(
    recipient,
    `Kairos Digest — ${unacked.length} moment(s)`,
    body,
    'custom',
    { priority: 'normal' }
  );
  state.settings.lastDigestAt = nowIso();
  await writeJsonState('kairos', state);
  return { sent: true };
}

// ============================================================================
// FEED / ACK
// ============================================================================

export interface KairosFeedOptions {
  limit?: number;
  kind?: KairosKind | string;
  severity?: KairosSeverity;
  acked?: boolean;
}

export async function kairosFeed(opts: KairosFeedOptions = {}): Promise<KairosMoment[]> {
  const state = await readJsonState<KairosState>('kairos', DEFAULT_STATE());
  let list = state.moments;
  if (opts.kind) list = list.filter((m) => m.kind === opts.kind);
  if (opts.severity) list = list.filter((m) => m.severity === opts.severity);
  if (opts.acked !== undefined) list = list.filter((m) => m.acked === opts.acked);
  // Ranked: critical first, then most recently seen.
  return [...list]
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        +new Date(b.lastSeen) - +new Date(a.lastSeen)
    )
    .slice(0, opts.limit ?? 50);
}

export async function ackMoment(id: string): Promise<boolean> {
  const state = await readJsonState<KairosState>('kairos', DEFAULT_STATE());
  const moment = state.moments.find((m) => m.id === id);
  if (!moment) return false;
  moment.acked = true;
  await writeJsonState('kairos', state);
  return true;
}

// ============================================================================
// DAEMON — idempotent in-process interval, catch-up scan on start
// ============================================================================

let _kairosTimer: ReturnType<typeof setInterval> | null = null;
let _scanRunning = false;

export function startKairos(): void {
  if (_kairosTimer) return; // already running
  // One-time cleanup of duplicate moments created by the old (non-normalizing)
  // dedupe hash — before the first scan so the feed starts clean.
  pruneDuplicateMoments()
    .then((kept) => {
      if (kept > 0) console.log(`[kairos] pruned duplicate moments (${kept} kept)`);
    })
    .catch(() => {});
  _kairosTimer = setInterval(() => {
    if (_scanRunning) return; // single-flight — never overlap
    _scanRunning = true;
    kairosScan()
      .catch((err) => console.error(`[kairos] scan failed: ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        _scanRunning = false;
      });
  }, tickMs());
  // unref() so the timer never keeps the process alive by itself.
  _kairosTimer.unref?.();
  // Catch-up scan the moment the daemon starts (leaked cron's "catch-up" task).
  kairosScan().catch((err) => console.error(`[kairos] catch-up scan failed: ${err instanceof Error ? err.message : err}`));
}

export function stopKairos(): void {
  if (_kairosTimer) {
    clearInterval(_kairosTimer);
    _kairosTimer = null;
  }
}

/**
 * Collapse duplicate moments left over from pre-normalization hashes. Every
 * scan used to include variable data (failure counts, relative ages) in the
 * dedupe key, so a monitor that stayed down spawned a fresh moment each tick.
 * Re-hash everything with the current normalizer and merge repeats into the
 * oldest entry, preserving ack state. Best-effort.
 */
export async function pruneDuplicateMoments(): Promise<number> {
  try {
    const state = await readJsonState<KairosState>('kairos', DEFAULT_STATE());
    if (!state.moments || state.moments.length === 0) return 0;

    const merged: KairosMoment[] = [];
    const byHash = new Map<string, KairosMoment>();
    for (const m of state.moments) {
      const key = momentHash(m.kind, m.detail);
      const existing = byHash.get(key);
      if (existing) {
        existing.occurrences += m.occurrences;
        existing.acked = existing.acked && m.acked;
        if (new Date(m.lastSeen) > new Date(existing.lastSeen)) existing.lastSeen = m.lastSeen;
        // Keep the highest severity seen.
        if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[existing.severity]) existing.severity = m.severity;
      } else {
        const copy = { ...m, hash: key };
        byHash.set(key, copy);
        merged.push(copy);
      }
    }
    if (merged.length === state.moments.length) return 0;
    state.moments = merged;
    state.updatedAt = nowIso();
    await writeJsonState('kairos', state);
    return state.moments.length;
  } catch (err) {
    console.error(`[kairos] prune failed: ${err instanceof Error ? err.message : err}`);
    return 0;
  }
}

export function isKairosRunning(): boolean {
  return _kairosTimer !== null;
}
