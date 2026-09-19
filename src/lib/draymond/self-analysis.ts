// ============================================================================
// DRAYMOND SELF-ANALYSIS LOOP — telemetry → prioritized improvement
// recommendations with a closed feedback loop.
// ============================================================================
// What this is NOT:
//   - Not Kairos (kairos surfaces *moments* — problem alerts, deduped, pushed).
//   - Not self-repair (that reacts to failure signals and applies safe fixes).
//   - Not dream-cycle (that consolidates memory).
//
// What this IS: a recurring analysis pass that ingests the fleet's state
// telemetry breadth (heartbeats, service activity, repair log, learning drift,
// treasury, scheduler job stats, execution cost), derives *trends* by diffing
// against previous runs, and emits prioritized, evidence-backed improvement
// recommendations. Findings carry a lifecycle (new → persistent → resolved);
// resolved findings are written back into the learning store as outcomes so
// the next lesson-distillation pass sees them — the closed loop.
//
// Deterministic only. No LLM. Every analyzer is fail-soft: a dead source
// degrades to a captured error in the report instead of killing the loop.
// runSelfAnalysis() NEVER rejects — every path returns a report.
// ============================================================================

import { readJsonState, writeJsonState, nowIso, uid } from './cognition';
import type { HeartbeatRecord } from './heartbeat';

export type AnalysisCategory = 'fleet' | 'repair' | 'learning' | 'revenue' | 'scheduler' | 'cost';
export type AnalysisSeverity = 'info' | 'warn' | 'critical';

export interface FindingDraft {
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  title: string;
  detail: string;
  evidence: string[];
}

export interface Finding extends FindingDraft {
  id: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: 'active' | 'resolved';
  /** Dedupe key: category + normalized title. */
  hash: string;
}

export interface Recommendation {
  id: string;
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  title: string;
  detail: string;
  proposedAction: string;
  evidence: string[];
  findingId: string;
  firstRecommendedAt: string;
}

export interface SelfAnalysisMetrics {
  fleet?: { total: number; up: number; down: number; stale: number };
  repair?: { windowAttempts: number; applied: number; escalated: number; successRate: number | null };
  learning?: { outcomes24h: number; failures24h: number; failRate: number | null; driftDetected: boolean; weightsStaleDays: number | null };
  revenue?: { pulseStaleDays: number | null; revenueCents: number };
  scheduler?: { failing: number; total: number };
  cost?: { cost24hCents: number | null; capCents: number };
}

export interface SelfAnalysisReport {
  id: string;
  ranAt: string;
  durationMs: number;
  findings: Finding[];
  recommendations: Recommendation[];
  metrics: SelfAnalysisMetrics;
  resolved: Array<{ findingId: string; title: string }>;
  errors: string[];
}

export interface SelfAnalysisState {
  findings: Finding[];
  reports: SelfAnalysisReport[];
  updatedAt: string;
}

// ============================================================================
// CONFIG — env-tunable, read per call (kairos pattern) so tests can flip values
// ============================================================================

function heartbeatStaleMs(): number {
  return Number(process.env.SELF_ANALYSIS_HEARTBEAT_STALE_MS ?? 30 * 60_000);
}
function repairWindowMs(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_REPAIR_WINDOW_MS ?? 7 * 86_400_000));
}
function repairEscalateMin(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_REPAIR_ESCALATE_MIN ?? 2));
}
function repairIneffectiveMin(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_REPAIR_INEFFECTIVE_MIN ?? 3));
}
function repairIneffectiveRate(): number {
  const raw = Number(process.env.SELF_ANALYSIS_REPAIR_INEFFECTIVE_RATE ?? 0.5);
  return raw > 0 && raw < 1 ? raw : 0.5;
}
function weightsStaleDays(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_WEIGHTS_STALE_DAYS ?? 14));
}
function learningWindowMs(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_LEARNING_WINDOW_MS ?? 24 * 3_600_000));
}
function learningFailMin(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_LEARNING_FAIL_MIN ?? 3));
}
function learningFailRate(): number {
  const raw = Number(process.env.SELF_ANALYSIS_LEARNING_FAIL_RATE ?? 0.5);
  return raw > 0 && raw < 1 ? raw : 0.5;
}
function revenuePulseStaleDays(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_REVENUE_PULSE_STALE_DAYS ?? 3));
}
function costCapCents(): number {
  const raw = Number(process.env.DRAYMOND_DAILY_COST_CAP_CENTS ?? 5000);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
}
function jobFailedStaleMs(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_JOB_FAILED_STALE_MS ?? 7 * 86_400_000));
}
/** Occurrences after which a finding's severity escalates (info→warn→critical). */
function escalateAfter(): number {
  return Math.max(2, Number(process.env.SELF_ANALYSIS_ESCALATE_AFTER ?? 3));
}
function capPerCategory(): number {
  return Math.max(1, Number(process.env.SELF_ANALYSIS_CAP_PER_CATEGORY ?? 10));
}
function findingsCap(): number {
  return Math.max(20, Number(process.env.SELF_ANALYSIS_FINDINGS_CAP ?? 200));
}
function reportsCap(): number {
  return Math.max(5, Number(process.env.SELF_ANALYSIS_REPORTS_CAP ?? 30));
}

const STATE_NAME = 'self-analysis';
const SEVERITY_RANK: Record<AnalysisSeverity, number> = { info: 0, warn: 1, critical: 2 };

// ============================================================================
// PURE HELPERS
// ============================================================================

/** Collapse variable fragments (repeat counters) so the SAME condition dedupes. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\(\d+x\)/g, '(Nx)')
    .trim();
}

/** Dedupe key for a finding: category + normalized title. */
export function findingHash(category: AnalysisCategory, title: string): string {
  return `${category}:${normalizeTitle(title)}`;
}

/**
 * Severity with occurrence-based escalation: a condition that keeps showing up
 * run after run is a stronger signal than a one-off. Never exceeds critical.
 */
export function escalatedSeverity(
  severity: AnalysisSeverity,
  occurrences: number,
  after: number = escalateAfter()
): AnalysisSeverity {
  if (occurrences >= after && SEVERITY_RANK[severity] < SEVERITY_RANK.critical) {
    return severity === 'info' ? 'warn' : 'critical';
  }
  return severity;
}

function fmtAge(seenMs: number, nowMs: number): string {
  const mins = Math.max(1, Math.round((nowMs - seenMs) / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

// ============================================================================
// STATE
// ============================================================================

function DEFAULT_STATE(): SelfAnalysisState {
  return { findings: [], reports: [], updatedAt: nowIso() };
}

async function readState(): Promise<SelfAnalysisState> {
  return readJsonState<SelfAnalysisState>(STATE_NAME, DEFAULT_STATE());
}

/** Latest report + full state (dashboard / API surface). */
export async function selfAnalysisState(): Promise<{ state: SelfAnalysisState; latest: SelfAnalysisReport | null }> {
  const state = await readState();
  return { state, latest: state.reports[0] ?? null };
}

// ============================================================================
// ANALYZERS — deterministic telemetry reads, one per source. Each lazy-imports
// its data source so a drifted/missing module fails one analyzer, not the loop.
// ============================================================================

/** Fleet liveness from .draymond/heartbeats.json (written by the heartbeat sweep). */
export async function analyzeFleet(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['fleet'] }> {
  const { getHeartbeats } = await import('./heartbeat');
  const hbs = await getHeartbeats().catch(() => ({} as Record<string, HeartbeatRecord>));
  const records = Object.values(hbs);
  const now = Date.now();
  const cutoff = now - heartbeatStaleMs();
  let up = 0;
  let down = 0;
  let stale = 0;
  const hits: FindingDraft[] = [];

  for (const rec of records) {
    const seen = new Date(rec.last_seen).getTime();
    const seenStale = Number.isNaN(seen) || seen < cutoff;
    if (!rec.up) {
      down += 1;
      hits.push({
        category: 'fleet',
        severity: 'critical',
        title: `Fleet service down: ${rec.name}`,
        detail: `${rec.name} is down${rec.detail ? ` — ${rec.detail}` : ''}`,
        evidence: [`last_seen ${rec.last_seen}`, ...(rec.detail ? [rec.detail] : [])],
      });
    } else if (seenStale) {
      stale += 1;
      hits.push({
        category: 'fleet',
        severity: 'warn',
        title: `Fleet heartbeat stale: ${rec.name}`,
        detail: `${rec.name} last seen ${Number.isNaN(seen) ? 'unknown' : fmtAge(seen, now)} ago`,
        evidence: [`last_seen ${rec.last_seen}`],
      });
    } else {
      up += 1;
    }
  }

  return { hits: hits.slice(0, capPerCategory()), stats: { total: records.length, up, down, stale } };
}

/** Repair effectiveness + loops from .draymond/repair-log.json. */
export async function analyzeRepair(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['repair'] }> {
  const { repairLog, detectRepairLoops } = await import('./self-repair');
  const log = await repairLog(200).catch(() => []);
  const cutoff = Date.now() - repairWindowMs();
  const recent = log.filter((a) => new Date(a.detectedAt).getTime() >= cutoff);
  const applied = recent.filter((a) => a.status === 'applied').length;
  const escalated = recent.filter((a) => a.status === 'escalated').length;
  const attempted = applied + escalated;
  const successRate = attempted > 0 ? applied / attempted : null;
  const hits: FindingDraft[] = [];

  // Repeated escalations on the same signal → the repair recipe is missing.
  const bySignal = new Map<string, number>();
  for (const a of recent) {
    if (a.status === 'escalated') bySignal.set(a.signal, (bySignal.get(a.signal) ?? 0) + 1);
  }
  const days = Math.max(1, Math.round(repairWindowMs() / 86_400_000));
  for (const [signal, n] of bySignal) {
    if (n >= repairEscalateMin()) {
      hits.push({
        category: 'repair',
        severity: 'warn',
        title: `Repair signal escalates: ${signal}`,
        detail: `"${signal}" escalated ${n}x in the last ${days}d with no successful repair`,
        evidence: [`${n} escalations`, `window ${days}d`],
      });
    }
  }

  // Repairs attempted but mostly failing → the repair recipe is wrong, not missing.
  if (attempted >= repairIneffectiveMin() && successRate !== null && successRate < repairIneffectiveRate()) {
    hits.push({
      category: 'repair',
      severity: 'warn',
      title: 'Repair attempts mostly fail',
      detail: `${applied}/${attempted} repairs applied (${(successRate * 100).toFixed(0)}%) in the last ${days}d`,
      evidence: [`applied ${applied}`, `escalated ${escalated}`, `window ${days}d`],
    });
  }

  // Blind repair loops (same signal auto-repaired over and over).
  const loops = await detectRepairLoops(10).catch(() => []);
  for (const l of loops) {
    hits.push({
      category: 'repair',
      severity: 'critical',
      title: `Blind repair loop: ${l.signal}`,
      detail: `${l.attempts} applied repairs in a window — the fix is not working, escalate`,
      evidence: [l.lastDetail],
    });
  }

  return {
    hits: hits.slice(0, capPerCategory()),
    stats: { windowAttempts: attempted, applied, escalated, successRate },
  };
}

/** Learning drift + outcome failure signal from .draymond/learning-store.json. */
export async function analyzeLearning(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['learning'] }> {
  const { readLearningStore } = await import('./learning-store');
  const store = await readLearningStore().catch(() => null);
  const hits: FindingDraft[] = [];
  if (!store) return { hits, stats: { outcomes24h: 0, failures24h: 0, failRate: null, driftDetected: false, weightsStaleDays: null } };

  const drift = store.driftMetrics;
  const driftDetected = Boolean(drift && (drift.conceptDriftDetected || drift.covariateShiftDetected));
  if (driftDetected) {
    hits.push({
      category: 'learning',
      severity: 'warn',
      title: 'Benchmark drift detected',
      detail: `concept=${Boolean(drift?.conceptDriftDetected)} covariate=${Boolean(drift?.covariateShiftDetected)} magnitude=${drift?.driftMagnitude?.toFixed(3) ?? 'n/a'} — ${drift?.recommendedAction ?? 'recalibrate benchmark weights'}`,
      evidence: [...(drift?.shiftedFeatures ?? []).slice(0, 5)],
    });
  }

  let weightStaleDays: number | null = null;
  const w = store.benchmarkWeights;
  if (w?.lastRecalibratedAt) {
    const recalcMs = new Date(w.lastRecalibratedAt).getTime();
    weightStaleDays = Number.isNaN(recalcMs) ? null : Math.max(0, Math.round((Date.now() - recalcMs) / 86_400_000));
    if (weightStaleDays !== null && weightStaleDays > weightsStaleDays()) {
      hits.push({
        category: 'learning',
        severity: 'warn',
        title: 'Benchmark weights stale',
        detail: `last recalibrated ${weightStaleDays}d ago${w.recalibrationReason ? ` (${w.recalibrationReason})` : ''}`,
        evidence: [`lastRecalibratedAt ${w.lastRecalibratedAt}`],
      });
    }
  }

  const cutoff = nowIso();
  const windowStart = new Date(Date.now() - learningWindowMs()).toISOString();
  const recent = store.outcomes.filter((o) => o.createdAt && o.createdAt >= windowStart && o.createdAt <= cutoff);
  const failures = recent.filter((o) => !o.success).length;
  const failRate = recent.length > 0 ? failures / recent.length : null;
  if (recent.length >= learningFailMin() && failRate !== null && failRate >= learningFailRate()) {
    hits.push({
      category: 'learning',
      severity: 'warn',
      title: 'High outcome failure rate',
      detail: `${failures}/${recent.length} learning outcomes failed in the last 24h`,
      evidence: recent.filter((o) => !o.success).slice(0, 5).map((o) => o.summary),
    });
  }

  return {
    hits: hits.slice(0, capPerCategory()),
    stats: { outcomes24h: recent.length, failures24h: failures, failRate, driftDetected, weightsStaleDays: weightStaleDays },
  };
}

/** Revenue pulse health from .draymond/treasury.json. */
export async function analyzeRevenue(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['revenue'] }> {
  const t = await readJsonState<{ revenueCents?: number; charges?: unknown; lastPulseAt?: string | null }>('treasury', {
    revenueCents: 0,
    lastPulseAt: null,
  });
  let pulseStaleDays: number | null = null;
  const hits: FindingDraft[] = [];

  if (t.lastPulseAt) {
    const pulseMs = new Date(t.lastPulseAt).getTime();
    if (!Number.isNaN(pulseMs)) {
      pulseStaleDays = Math.max(0, Math.round((Date.now() - pulseMs) / 86_400_000));
      if (pulseStaleDays > revenuePulseStaleDays()) {
        hits.push({
          category: 'revenue',
          severity: 'warn',
          title: 'Revenue pulse stale',
          detail: `treasury last pulsed ${pulseStaleDays}d ago — revenue tracking is stale`,
          evidence: [`lastPulseAt ${t.lastPulseAt}`],
        });
      }
    }
  }

  // Recent-but-zero pulse with no settled revenue: the pipeline itself is quiet.
  if (pulseStaleDays !== null && pulseStaleDays <= 7 && (t.revenueCents ?? 0) === 0) {
    hits.push({
      category: 'revenue',
      severity: 'info',
      title: 'No settled revenue recorded',
      detail: 'Treasury shows $0 settled while the pulse is recent — verify the Stripe webhook / charges sync',
      evidence: ['revenueCents 0'],
    });
  }

  return { hits, stats: { pulseStaleDays, revenueCents: t.revenueCents ?? 0 } };
}

/** Scheduler reliability from draymond_scheduled_jobs. */
export async function analyzeScheduler(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['scheduler'] }> {
  const { listJobs } = await import('./scheduler');
  const [all, failed] = await Promise.all([
    listJobs({ is_enabled: true, limit: 200 }).catch(() => []),
    listJobs({ is_enabled: true, last_run_status: 'failed', limit: 50 }).catch(() => []),
  ]);
  const cutoff = Date.now() - jobFailedStaleMs();
  const recentFailing = failed.filter((j) => j.last_run_at && new Date(j.last_run_at).getTime() >= cutoff);
  const hits: FindingDraft[] = [];

  if (recentFailing.length > 0) {
    const hardFails = recentFailing.filter((j) => (j.fail_count ?? 0) >= 3);
    hits.push({
      category: 'scheduler',
      severity: hardFails.length > 0 ? 'critical' : 'warn',
      title: `${recentFailing.length} scheduled job(s) failing`,
      detail: `${recentFailing.length} enabled job(s) last-run failed within the window${hardFails.length > 0 ? ` (${hardFails.length} with 3+ cumulative failures)` : ''}`,
      evidence: recentFailing.slice(0, 5).map((j) => `${j.name}: ${(j.last_error ?? 'unknown error').slice(0, 160)}`),
    });
  }

  return { hits, stats: { failing: recentFailing.length, total: all.length } };
}

/** 24h execution cost vs the daily cap (Supabase-backed; fail-soft when absent). */
export async function analyzeCost(): Promise<{ hits: FindingDraft[]; stats: SelfAnalysisMetrics['cost'] }> {
  const cap = costCapCents();
  const { getCostSummary } = await import('./analytics');
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const summary = await getCostSummary(since).catch(() => null);
  if (!summary) return { hits: [], stats: { cost24hCents: null, capCents: cap } };

  const hits: FindingDraft[] = [];
  if (summary.total_cents >= cap) {
    hits.push({
      category: 'cost',
      severity: 'warn',
      title: `Fleet cost over $${(cap / 100).toFixed(2)}/day`,
      detail: `Last 24h execution cost $${(summary.total_cents / 100).toFixed(2)} exceeds the daily cap`,
      evidence: [`total_cents ${summary.total_cents}`, `cap_cents ${cap}`],
    });
  }
  return { hits, stats: { cost24hCents: summary.total_cents, capCents: cap } };
}

const ANALYZERS: Array<{ category: AnalysisCategory; run: () => Promise<{ hits: FindingDraft[]; stats?: unknown }> }> = [
  { category: 'fleet', run: analyzeFleet },
  { category: 'repair', run: analyzeRepair },
  { category: 'learning', run: analyzeLearning },
  { category: 'revenue', run: analyzeRevenue },
  { category: 'scheduler', run: analyzeScheduler },
  { category: 'cost', run: analyzeCost },
];

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

/** Concrete, deterministic proposed action per category. */
function proposedActionFor(category: AnalysisCategory, finding: Finding): string {
  switch (category) {
    case 'fleet':
      return finding.title.startsWith('Fleet service down')
        ? 'Run service_health_repair / agent_heartbeat_sweep; if the service has no local start recipe, register one in service-manager.'
        : 'Run agent_heartbeat_sweep; investigate why the service stopped answering probes.';
    case 'repair':
      return 'Escalate to on-call; if a proven fix exists, register it via DRAYMOND_REPAIR_MAP, or mark the signal benign via DRAYMOND_IGNORE_SIGNALS.';
    case 'learning':
      return 'Run self_learning_loop; recalibrate benchmark weights via a benchmark cycle (benchmark_sync_roster).';
    case 'revenue':
      return 'Run treasury_pulse; verify the Stripe webhook and charges sync are healthy.';
    case 'scheduler':
      return 'Run repair_failed_jobs; if the job cannot be repaired, disable it or fix its config.';
    case 'cost':
      return 'Review delegation budgets / provider routing; check .draymond/pool-health.json for entitlement gaps.';
  }
}

function buildRecommendation(finding: Finding): Recommendation {
  return {
    id: uid('rc'),
    category: finding.category,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    proposedAction: proposedActionFor(finding.category, finding),
    evidence: finding.evidence,
    findingId: finding.id,
    firstRecommendedAt: finding.firstSeen,
  };
}

// ============================================================================
// ORCHESTRATION
// ============================================================================

/**
 * Run one self-analysis pass. Ingests telemetry, diffs against previous runs,
 * updates the finding lifecycle, emits recommendations, closes the loop on
 * resolved findings, and persists .draymond/self-analysis.json. NEVER rejects.
 */
export async function runSelfAnalysis(): Promise<SelfAnalysisReport> {
  const started = Date.now();
  const errors: string[] = [];
  const metrics: SelfAnalysisMetrics = {};
  const drafts: FindingDraft[] = [];

  for (const analyzer of ANALYZERS) {
    try {
      const result = await analyzer.run();
      drafts.push(...result.hits);
      if (result.stats) Object.assign(metrics, result.stats as SelfAnalysisMetrics);
    } catch (err) {
      errors.push(`${analyzer.category}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const state = await readState();
  const now = nowIso();
  const byHash = new Map(state.findings.map((f) => [f.hash, f]));
  const currentHashes = new Set<string>();
  const nextFindings: Finding[] = [];
  const resolved: Array<{ findingId: string; title: string }> = [];

  // New / updated findings from this run's telemetry.
  for (const d of drafts) {
    const hash = findingHash(d.category, d.title);
    currentHashes.add(hash);
    const existing = byHash.get(hash);
    if (existing && existing.status === 'active') {
      existing.occurrences += 1;
      existing.lastSeen = now;
      existing.severity = escalatedSeverity(existing.severity, existing.occurrences);
      nextFindings.push(existing);
    } else {
      const finding: Finding = {
        ...d,
        id: uid('sa'),
        firstSeen: now,
        lastSeen: now,
        occurrences: 1,
        status: 'active',
        hash,
      };
      nextFindings.push(finding);
    }
  }

  // Resolve previously-active findings that this run's telemetry no longer reports.
  for (const f of state.findings) {
    if (f.status === 'active' && !currentHashes.has(f.hash)) {
      f.status = 'resolved';
      resolved.push({ findingId: f.id, title: f.title });
      nextFindings.push(f);
      await recordResolvedOutcome(f).catch(() => {});
    }
  }

  // Prioritize: active findings first (severity desc), then resolved (most recent first).
  nextFindings.sort(
    (a, b) =>
      Number(a.status === 'active') - Number(b.status === 'active') ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      +new Date(b.lastSeen) - +new Date(a.lastSeen)
  );

  // Recommendations from active findings that crossed the warn threshold.
  const recommendations = nextFindings
    .filter((f) => f.status === 'active' && f.severity !== 'info')
    .map((f) => buildRecommendation(f));

  const report: SelfAnalysisReport = {
    id: uid('sar'),
    ranAt: now,
    durationMs: Date.now() - started,
    findings: nextFindings,
    recommendations,
    metrics,
    resolved,
    errors,
  };

  state.findings = nextFindings.slice(0, findingsCap());
  state.reports = [report, ...state.reports].slice(0, reportsCap());
  await writeJsonState(STATE_NAME, state).catch(() => {});

  // Audit trail for the loop itself (best-effort).
  try {
    const { logEvent } = await import('./index');
    if (report.recommendations.length > 0) {
      await logEvent({
        agent_id: 'draymond',
        category: 'confidence',
        severity: report.recommendations.some((r) => r.severity === 'critical') ? 'warning' : 'info',
        event_type: 'self_analysis_report',
        message: `[Self-Analysis] ${report.recommendations.length} recommendation(s), ${resolved.length} resolved, ${errors.length} source error(s)`,
        metadata: {
          reportId: report.id,
          recommendations: report.recommendations.map((r) => `${r.severity}:${r.category}:${r.title}`),
          resolved,
        },
      }).catch(() => {});
    }
  } catch {
    /* best-effort */
  }

  return report;
}

/** Closed loop: a cleared condition becomes a learning outcome → lesson. */
async function recordResolvedOutcome(finding: Finding): Promise<void> {
  const { addOutcome } = await import('./learning-store');
  await addOutcome({
    agentId: `self-analysis:${finding.category}`,
    kind: 'incident',
    summary: `self-analysis resolved: ${finding.title}`,
    success: true,
    detail: `${finding.category} condition cleared — active since ${finding.firstSeen} (${finding.occurrences} run(s))`,
  });
}