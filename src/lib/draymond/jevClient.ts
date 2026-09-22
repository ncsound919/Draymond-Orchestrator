/**
 * jevClient.ts — Jev (System One) ops-decision client for Draymond.
 *
 * Jev returns typed `choice` / `noul` / `score` answers over a `state` — no
 * prose. Used for operational decisions: daily tasks, cron runs, repairs,
 * reporting, learning/growth, and service bring-up / power-down. Two-tier
 * chain (matches the fleet clients):
 *   tier 1 = Vercel AI Gateway TypeSafe lane (TYPESAFE_BASE_URL + a key),
 *   tier 2 = LocalJev on :8080 (JEV_LOCAL_BASE_URL, no key required).
 * The gateway is tried first when a key is configured; any failure falls back
 * to localjev. Both down => source "offline" — never a fabricated decision.
 * The deterministic orchestrator logic stays authoritative; Jev adds calibrated
 * advisories alongside.
 */

export type JevState = string | unknown[] | Record<string, unknown>;

export interface JevChoiceQuestion {
  type: 'choice';
  instructions: unknown;
  criteria: Record<string, unknown>;
}

export interface JevNoulQuestion {
  type: 'noul';
  instructions: unknown;
  criteria?: { true: unknown; false: unknown } | null;
}

export interface JevScoreQuestion {
  type: 'score';
  instructions: unknown;
  criteria: unknown[];
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion;

export type JevAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'noul'; noul: number }
  | { type: 'score'; score: number; legend: Record<string, unknown>; probabilities: Record<string, number>; confidence: number };

export interface JevTierConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface JevConfig {
  enabled: boolean;
  timeoutMs: number;
  gateway: JevTierConfig;
  local: JevTierConfig;
}

const GATEWAY_BASE_URL_DEFAULT = 'https://ai-gateway.vercel.sh/typesafe';
const GATEWAY_MODEL_DEFAULT = 'typesafe-ai/jev';
const LOCAL_BASE_URL_DEFAULT = 'http://127.0.0.1:8080';
const LOCAL_MODEL_DEFAULT = 'jev-latest';

export function jevConfig(): JevConfig {
  const gateway: JevTierConfig = {
    baseUrl: (process.env.TYPESAFE_BASE_URL || GATEWAY_BASE_URL_DEFAULT).replace(/\/+$/, ''),
    apiKey: (process.env.TYPESAFE_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.JEV_API_KEY || '').trim(),
    model: process.env.TYPESAFE_MODEL || GATEWAY_MODEL_DEFAULT,
  };
  const local: JevTierConfig = {
    baseUrl: (process.env.JEV_LOCAL_BASE_URL || LOCAL_BASE_URL_DEFAULT).replace(/\/+$/, ''),
    apiKey: '',
    model: process.env.JEV_LOCAL_MODEL || LOCAL_MODEL_DEFAULT,
  };
  const enabled = process.env.DRAYMOND_JEV_ENABLED !== '0';
  const timeoutMs = Number(process.env.JEV_TIMEOUT_MS) || 10_000;
  return { enabled, timeoutMs, gateway, local };
}

export function jevEnabled(): boolean {
  const c = jevConfig();
  return c.enabled && (Boolean(c.gateway.baseUrl) || Boolean(c.local.baseUrl));
}

export interface JevTierStatus {
  id: 'gateway' | 'local';
  baseUrl: string;
  model: string;
  online: boolean;
  error?: string;
}

export interface JevStatus {
  configured: boolean;
  enabled: boolean;
  tiers: JevTierStatus[];
  online: boolean;
  checkedAt?: number;
}

async function rawFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeTier(id: 'gateway' | 'local', tier: JevTierConfig): Promise<JevTierStatus> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tier.apiKey) headers.Authorization = `Bearer ${tier.apiKey}`;
  try {
    const res = await rawFetch(`${tier.baseUrl}/v1/models`, { method: 'GET', headers }, 3000);
    return { id, baseUrl: tier.baseUrl, model: tier.model, online: res.ok, error: res.ok ? undefined : `GET /v1/models -> HTTP ${res.status}` };
  } catch (err: unknown) {
    return { id, baseUrl: tier.baseUrl, model: tier.model, online: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}

export async function jevStatus(): Promise<JevStatus> {
  const c = jevConfig();
  const [gateway, local] = await Promise.all([probeTier('gateway', c.gateway), probeTier('local', c.local)]);
  return { configured: true, enabled: c.enabled, tiers: [gateway, local], online: gateway.online || local.online, checkedAt: Date.now() };
}

export interface SystemOneInput {
  state: JevState;
  questions: Record<string, JevQuestion>;
  model?: string;
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface JevResult {
  ok: boolean;
  source: 'vercel' | 'localjev' | 'offline';
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: JevUsage;
  latencyMs: number;
  error?: string;
  httpStatus?: number;
}

function authHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/** One tier's call result before the caller assigns `source`. */
type TierResult = Omit<JevResult, 'source'>;

async function postSystemOne(tier: JevTierConfig, input: SystemOneInput, timeoutMs: number, started: number): Promise<TierResult> {
  const endpoint = `${tier.baseUrl}/v1/systemone`;
  const body = { model: input.model ?? tier.model, state: input.state, questions: input.questions };
  const retryable = new Set([429, 529]);
  let lastStatus = 0;
  let lastError = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(300, 200 * attempt)));
    try {
      const res = await rawFetch(endpoint, { method: 'POST', headers: authHeaders(tier.apiKey), body: JSON.stringify(body) }, timeoutMs);
      lastStatus = res.status;
      if (retryable.has(res.status)) {
        lastError = `HTTP ${res.status} (transient overload; retrying)`;
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastError = `POST ${endpoint} -> HTTP ${res.status}: ${text.slice(0, 200)}`;
        return { ok: false, latencyMs: Date.now() - started, error: lastError, httpStatus: res.status };
      }
      const data: unknown = await res.json();
      const payload = data as Record<string, unknown>;
      const answers: Record<string, JevAnswer> | undefined = payload && typeof payload.answers === 'object' && payload.answers !== null ? (payload.answers as Record<string, JevAnswer>) : undefined;
      if (!answers) return { ok: false, latencyMs: Date.now() - started, error: 'Jev response missing answers' };
      const usage: JevUsage | undefined =
        payload?.usage && typeof (payload.usage as Record<string, unknown>).input_tokens === 'number'
          ? { inputTokens: (payload.usage as Record<string, unknown>).input_tokens as number, outputTokens: Number((payload.usage as Record<string, unknown>).output_tokens) || 0 }
          : undefined;
      return { ok: true, model: typeof payload.model === 'string' ? (payload.model as string) : tier.model, answers, usage, latencyMs: Date.now() - started };
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = aborted ? `request timed out after ${timeoutMs}ms` : (err instanceof Error ? err.message : 'request failed');
      if (!aborted) break;
    }
  }
  return { ok: false, latencyMs: Date.now() - started, error: lastError, httpStatus: lastStatus || undefined };
}

/** One typed decision call with the gateway → localjev fallback chain. */
export async function decideSystemOne(input: SystemOneInput): Promise<JevResult> {
  const c = jevConfig();
  const started = Date.now();
  if (!jevEnabled()) {
    return { ok: false, source: 'offline', latencyMs: Date.now() - started, error: c.enabled ? 'no Jev tier configured' : 'Jev decision engine disabled (DRAYMOND_JEV_ENABLED=0)' };
  }
  if (c.gateway.apiKey) {
    const r = await postSystemOne(c.gateway, input, c.timeoutMs, started);
    if (r.ok) return { ...r, source: 'vercel' };
  }
  const local = await postSystemOne(c.local, input, c.timeoutMs, started);
  if (local.ok) return { ...local, source: 'localjev' };
  return { ...local, source: 'offline' };
}

// ─── Ops-decision advisory builders ──────────────────────────────────────────

export type JevSource = 'vercel' | 'localjev' | 'offline';

interface AdvisoryBase {
  ok: boolean;
  source: JevSource;
  model?: string;
  error?: string;
}

// Daily tasks (day-orchestrator): which task first + priority.
export function dailyTaskAdvisory(tasks: Array<{ id: string; label: string }>): { state: JevState; questions: Record<string, JevQuestion> } {
  const criteria: Record<string, string> = {};
  for (const t of tasks.slice(0, 12)) criteria[t.id] = t.label.slice(0, 70);
  // Jev requires 2-128 choice options; an empty/single task day must still pass.
  if (Object.keys(criteria).length < 2) criteria.defer = 'Defer / no task now';
  const state = { action: 'daily_tasks', tasks: tasks.slice(0, 12) };
  const questions: Record<string, JevQuestion> = {
    first: { type: 'choice', instructions: 'Which daily task should be executed first?', criteria },
    load: { type: 'score', instructions: 'How heavy is today\'s task load?', criteria: ['Light', 'Moderate', 'Heavy', 'Overwhelming'] },
  };
  return { state, questions };
}

export interface DailyTaskJevAdvisory extends AdvisoryBase {
  firstTask?: string;
  firstTaskProbability?: number;
  loadScore?: number;
}

export function buildDailyTaskAdvisory(result: JevResult): DailyTaskJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const first = result.answers.first;
  const load = result.answers.load;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    firstTask: first && first.type === 'choice' ? first.choice : undefined,
    firstTaskProbability: first && first.type === 'choice' ? (first.probabilities?.[first.choice] ?? 0) : undefined,
    loadScore: load && load.type === 'score' ? load.score : undefined,
  };
}

// Cron runs (scheduler): should this job run now?
export function cronRunAdvisory(job: { name: string; job_type: string }): { state: JevState; questions: Record<string, JevQuestion> } {
  const state = { action: 'cron_run', job: job.name, jobType: job.job_type };
  const questions: Record<string, JevQuestion> = {
    run: { type: 'noul', instructions: 'Should this scheduled job run now?', criteria: { true: 'Run now', false: 'Defer' } },
    priority: { type: 'score', instructions: 'How urgent is this job relative to other work?', criteria: ['Low', 'Normal', 'High', 'Critical'] },
  };
  return { state, questions };
}

export interface CronRunJevAdvisory extends AdvisoryBase {
  run?: boolean;
  noul?: number;
  priorityScore?: number;
}

export function buildCronRunAdvisory(result: JevResult): CronRunJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const run = result.answers.run;
  const priority = result.answers.priority;
  const noul = run && run.type === 'noul' ? run.noul : undefined;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    run: noul === undefined ? undefined : noul >= 0.5,
    noul,
    priorityScore: priority && priority.type === 'score' ? priority.score : undefined,
  };
}

// Repairs (repair-team): which lane + dispatch now?
export function repairAdvisory(failure: { signal: string; kind?: string; detail?: string }): { state: JevState; questions: Record<string, JevQuestion> } {
  const state = {
    action: 'repair',
    signal: failure.signal.slice(0, 160),
    kind: failure.kind ?? 'unknown',
    detail: (failure.detail ?? '').slice(0, 400),
  };
  const questions: Record<string, JevQuestion> = {
    lane: {
      type: 'choice',
      instructions: 'Which repair lane should handle this?',
      criteria: { coding: 'Code error / integration fix', config: 'Config / env fix', service: 'Service restart / bring-up', escalate: 'Escalate to an operator' },
    },
    dispatch: { type: 'noul', instructions: 'Dispatch a repair attempt now?', criteria: { true: 'Dispatch', false: 'Hold' } },
  };
  return { state, questions };
}

export interface RepairJevAdvisory extends AdvisoryBase {
  lane?: string;
  laneProbability?: number;
  dispatch?: boolean;
  noul?: number;
}

export function buildRepairAdvisory(result: JevResult): RepairJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const lane = result.answers.lane;
  const dispatch = result.answers.dispatch;
  const noul = dispatch && dispatch.type === 'noul' ? dispatch.noul : undefined;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    lane: lane && lane.type === 'choice' ? lane.choice : undefined,
    laneProbability: lane && lane.type === 'choice' ? (lane.probabilities?.[lane.choice] ?? 0) : undefined,
    dispatch: noul === undefined ? undefined : noul >= 0.5,
    noul,
  };
}

// Reporting: publish now? + value.
export function reportAdvisory(report: { topic: string; length?: number }): { state: JevState; questions: Record<string, JevQuestion> } {
  const state = { action: 'report', topic: report.topic.slice(0, 160), length: report.length ?? 0 };
  const questions: Record<string, JevQuestion> = {
    publish: { type: 'noul', instructions: 'Publish this report now?', criteria: { true: 'Publish', false: 'Hold' } },
    value: { type: 'score', instructions: 'How valuable is this report to the fleet?', criteria: ['Low', 'Moderate', 'High', 'Critical'] },
  };
  return { state, questions };
}

export interface ReportJevAdvisory extends AdvisoryBase {
  publish?: boolean;
  noul?: number;
  valueScore?: number;
}

export function buildReportAdvisory(result: JevResult): ReportJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const publish = result.answers.publish;
  const value = result.answers.value;
  const noul = publish && publish.type === 'noul' ? publish.noul : undefined;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    publish: noul === undefined ? undefined : noul >= 0.5,
    noul,
    valueScore: value && value.type === 'score' ? value.score : undefined,
  };
}

// Learning & growth: what to learn next + lesson value.
export function learningAdvisory(lessons: Array<{ id: string; lesson: string; evidenceCount?: number }>): { state: JevState; questions: Record<string, JevQuestion> } {
  const criteria: Record<string, string> = {};
  for (const l of lessons.slice(0, 12)) criteria[l.id] = `${l.lesson.slice(0, 60)}${l.evidenceCount ? ` (evidence ${l.evidenceCount})` : ''}`;
  if (Object.keys(criteria).length < 2) criteria.defer = 'Defer / no lesson now';
  const state = { action: 'learning', lessons: lessons.slice(0, 12) };
  const questions: Record<string, JevQuestion> = {
    learn: { type: 'choice', instructions: 'Which lesson should Draymond internalize next?', criteria },
    value: { type: 'score', instructions: 'How actionable is the top lesson?', criteria: ['Low', 'Moderate', 'High', 'Transformative'] },
  };
  return { state, questions };
}

export interface LearningJevAdvisory extends AdvisoryBase {
  lessonId?: string;
  lessonProbability?: number;
  valueScore?: number;
}

export function buildLearningAdvisory(result: JevResult): LearningJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const learn = result.answers.learn;
  const value = result.answers.value;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    lessonId: learn && learn.type === 'choice' ? learn.choice : undefined,
    lessonProbability: learn && learn.type === 'choice' ? (learn.probabilities?.[learn.choice] ?? 0) : undefined,
    valueScore: value && value.type === 'score' ? value.score : undefined,
  };
}

// Service lifecycle (service-manager): bring-up / power-down decision.
export function serviceLifecycleAdvisory(service: { slug: string; name: string; port: number | null; health: string }, action: 'start' | 'stop' | 'restart'): { state: JevState; questions: Record<string, JevQuestion> } {
  const state = { action: `service_${action}`, slug: service.slug, name: service.name, port: service.port, health: service.health };
  const questions: Record<string, JevQuestion> = {
    proceed: {
      type: 'noul',
      instructions: `Should we ${action} service "${service.name}" (${service.slug}) now?`,
      criteria: { true: `Yes, ${action}`, false: 'No, leave it' },
    },
    risk: { type: 'score', instructions: 'Rate the blast radius of this action.', criteria: ['None', 'Low', 'Medium', 'High'] },
  };
  return { state, questions };
}

export interface ServiceLifecycleJevAdvisory extends AdvisoryBase {
  proceed?: boolean;
  noul?: number;
  riskScore?: number;
}

export function buildServiceLifecycleAdvisory(result: JevResult): ServiceLifecycleJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const proceed = result.answers.proceed;
  const risk = result.answers.risk;
  const noul = proceed && proceed.type === 'noul' ? proceed.noul : undefined;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    proceed: noul === undefined ? undefined : noul >= 0.5,
    noul,
    riskScore: risk && risk.type === 'score' ? risk.score : undefined,
  };
}

export interface ServiceHealthLike {
  slug: string;
  name: string;
  port: number | null;
  health: string;
}

/** Fleet bring-up decision: which down service to start first + how heavy the
 *  bring-up load is. Services are real (probeAllServices output); Jev only ranks. */
export function bringUpChoiceAdvisory(down: ServiceHealthLike[]): { state: JevState; questions: Record<string, JevQuestion> } {
  const criteria: Record<string, string> = {};
  for (const s of down.slice(0, 16)) criteria[s.slug] = `${s.name.slice(0, 60)} (port ${s.port ?? '?'})`;
  if (Object.keys(criteria).length < 2) criteria.defer = 'Defer / no bring-up now';
  const state = { action: 'service_bringup', down: down.slice(0, 16) };
  const questions: Record<string, JevQuestion> = {
    first: { type: 'choice', instructions: 'Which down service should be brought up first?', criteria },
    load: { type: 'score', instructions: 'How heavy is this bring-up batch?', criteria: ['Light', 'Moderate', 'Heavy', 'Very heavy'] },
  };
  return { state, questions };
}

export interface BringUpJevAdvisory extends AdvisoryBase {
  firstSlug?: string;
  firstProbability?: number;
  loadScore?: number;
}

export function buildBringUpChoiceAdvisory(result: JevResult): BringUpJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const first = result.answers.first;
  const load = result.answers.load;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    firstSlug: first && first.type === 'choice' ? first.choice : undefined,
    firstProbability: first && first.type === 'choice' ? (first.probabilities?.[first.choice] ?? 0) : undefined,
    loadScore: load && load.type === 'score' ? load.score : undefined,
  };
}

// Brain decision (brain-decision.ts): where to focus + act now?
export function brainDecisionAdvisory(decision: { focusGoal: string | null; priorities: Array<{ id: string; label: string }>; repairQueueLength: number }): { state: JevState; questions: Record<string, JevQuestion> } {
  const criteria: Record<string, string> = {};
  for (const p of decision.priorities.slice(0, 8)) criteria[p.id] = p.label.slice(0, 70);
  if (Object.keys(criteria).length < 2) criteria.defer = 'Defer / no focus now';
  const state = {
    action: 'brain_decision',
    focusGoal: decision.focusGoal ?? null,
    repairQueueLength: decision.repairQueueLength,
    priorities: decision.priorities.slice(0, 8),
  };
  const questions: Record<string, JevQuestion> = {
    focus: { type: 'choice', instructions: 'Where should Draymond focus first?', criteria },
    act: { type: 'noul', instructions: 'Proceed with the top priority now?', criteria: { true: 'Proceed', false: 'Hold' } },
  };
  return { state, questions };
}

export interface BrainDecisionJevAdvisory extends AdvisoryBase {
  focusId?: string;
  focusProbability?: number;
  act?: boolean;
  noul?: number;
}

export function buildBrainDecisionAdvisory(result: JevResult): BrainDecisionJevAdvisory {
  if (!result.ok || !result.answers) return { ok: false, source: 'offline', error: result.error };
  const focus = result.answers.focus;
  const act = result.answers.act;
  const noul = act && act.type === 'noul' ? act.noul : undefined;
  return {
    ok: true,
    source: result.source,
    model: result.model,
    focusId: focus && focus.type === 'choice' ? focus.choice : undefined,
    focusProbability: focus && focus.type === 'choice' ? (focus.probabilities?.[focus.choice] ?? 0) : undefined,
    act: noul === undefined ? undefined : noul >= 0.5,
    noul,
  };
}

/** Unifies a decision call: build the right questions for `kind`, call Jev,
 *  parse into a typed advisory. Returns the raw result too for callers that
 *  want the full answers object. */
export async function decideFor(
  kind: 'daily' | 'cron' | 'repair' | 'report' | 'learning' | 'service' | 'brain',
  input: Record<string, unknown>,
): Promise<{ jev: AdvisoryBase; result: JevResult }> {
  let built: { state: JevState; questions: Record<string, JevQuestion> };
  const asArray = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  switch (kind) {
    case 'daily':
      built = dailyTaskAdvisory(asArray(input.tasks).map((t) => ({ id: String(t.id ?? ''), label: String(t.label ?? '') })));
      break;
    case 'cron':
      built = cronRunAdvisory({ name: String((input.job as Record<string, unknown> | undefined)?.name ?? 'unknown'), job_type: String((input.job as Record<string, unknown> | undefined)?.job_type ?? 'unknown') });
      break;
    case 'repair':
      built = repairAdvisory({ signal: String((input.failure as Record<string, unknown> | undefined)?.signal ?? input.signal ?? 'unknown'), kind: String((input.failure as Record<string, unknown> | undefined)?.kind ?? ''), detail: String((input.failure as Record<string, unknown> | undefined)?.detail ?? '') });
      break;
    case 'report':
      built = reportAdvisory({ topic: String((input.report as Record<string, unknown> | undefined)?.topic ?? 'report') });
      break;
    case 'learning':
      built = learningAdvisory(asArray(input.lessons).map((l) => ({ id: String(l.id ?? ''), lesson: String(l.lesson ?? ''), evidenceCount: typeof l.evidenceCount === 'number' ? l.evidenceCount : undefined })));
      break;
    case 'service':
      built = serviceLifecycleAdvisory((input.service as Record<string, unknown> ?? { slug: 'unknown', name: 'unknown', port: null, health: 'unknown' }) as unknown as ServiceHealthLike, (input.action as 'start' | 'stop' | 'restart') ?? 'start');
      break;
    case 'brain':
      built = brainDecisionAdvisory({ focusGoal: String((input.decision as Record<string, unknown> | undefined)?.focusGoal ?? null), priorities: asArray((input.decision as Record<string, unknown> | undefined)?.priorities).map((p) => ({ id: String(p.id ?? ''), label: String(p.label ?? '') })), repairQueueLength: Number((input.decision as Record<string, unknown> | undefined)?.repairQueueLength) || 0 });
      break;
  }
  const result = await decideSystemOne({ state: built.state, questions: built.questions });
  const parsers = {
    daily: buildDailyTaskAdvisory,
    cron: buildCronRunAdvisory,
    repair: buildRepairAdvisory,
    report: buildReportAdvisory,
    learning: buildLearningAdvisory,
    service: buildServiceLifecycleAdvisory,
    brain: buildBrainDecisionAdvisory,
  } as const;
  return { jev: parsers[kind](result), result };
}