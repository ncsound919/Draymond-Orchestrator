/**
 * Ultraplan — queue-based deep-planning service.
 *
 * State machine: queued → planning → plan_ready → approved | rejected | failed.
 * The deep lane prefers a native-reasoning call (Anthropic thinking / DeepSeek
 * reasoner / OpenAI reasoning_effort); otherwise it runs a draft → critique →
 * revise deepen loop on the normal provider chain. Approved plans are stored as
 * memories with a manual "run as chain" follow-up (no auto-execution in v1).
 */

import { readJsonState, writeJsonState, nowIso, uid } from './cognition';
import type { UltraplanArtifact } from './cognition';
import { storeMemory } from './index';

export type UltraplanStatus = 'queued' | 'planning' | 'plan_ready' | 'approved' | 'rejected' | 'failed';

export interface UltraplanTask {
  title: string;
  brief: string;
  scope?: string;
  sources?: string[];
}

export interface UltraplanPlan {
  id: string;
  status: UltraplanStatus;
  task: UltraplanTask;
  createdAt: string;
  updatedAt: string;
  plan?: UltraplanArtifact;
  error?: string;
}

export interface UltraplanState {
  plans: UltraplanPlan[];
  updatedAt: string;
}

const ACTIVE: UltraplanStatus[] = ['queued', 'planning', 'plan_ready'];

function DEFAULT_STATE(): UltraplanState {
  return { plans: [], updatedAt: nowIso() };
}

function maxQueue(): number {
  return Math.max(1, Number(process.env.ULTRAPLAN_MAX_QUEUE ?? 50));
}
function stuckMs(): number {
  return Math.max(1000, Number(process.env.ULTRAPLAN_STUCK_MS ?? 30 * 60_000));
}

const SYSTEM_PROMPT = [
  'You are Draymond\'s deep-planning engine. Given a task brief, produce a JSON plan artifact with EXACTLY these keys:',
  'goals (string[]), phases (string[]), steps (string[]),',
  'changes (array of { file, description, line? }) grounded in real file paths (file:line where known),',
  'dependencies (string[]), risks (string[]), verification (string[]), tokenEstimate (number).',
  'Output ONLY the JSON object.',
].join('\n');

function buildBrief(task: UltraplanTask): string {
  return [
    '# Task',
    task.title,
    '',
    '## Brief',
    task.brief,
    '',
    task.scope ? `## Scope\n${task.scope}` : '',
    '',
    task.sources?.length ? `## Sources\n${task.sources.map((s) => `- ${s}`).join('\n')}` : '',
  ].join('\n');
}

// ============================================================================
// QUEUE CRUD
// ============================================================================

export async function enqueueUltraplan(task: UltraplanTask): Promise<UltraplanPlan> {
  const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
  const active = state.plans.filter((p) => ACTIVE.includes(p.status)).length;
  if (active >= maxQueue()) throw new Error(`Ultraplan queue full (max ${maxQueue()})`);
  const plan: UltraplanPlan = {
    id: uid('up'),
    status: 'queued',
    task: { title: task.title, brief: task.brief, scope: task.scope, sources: task.sources },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  state.plans.unshift(plan);
  await writeJsonState('ultraplan', state);
  return plan;
}

export async function getUltraplan(id: string): Promise<UltraplanPlan | null> {
  const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
  return state.plans.find((p) => p.id === id) ?? null;
}

export async function listUltraplans(filters: { status?: UltraplanStatus } = {}): Promise<UltraplanPlan[]> {
  const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
  const list = filters.status ? state.plans.filter((p) => p.status === filters.status) : state.plans;
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function updatePlan(id: string, fn: (p: UltraplanPlan) => void): Promise<UltraplanPlan> {
  const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
  const plan = state.plans.find((p) => p.id === id);
  if (!plan) throw new Error(`Ultraplan ${id} not found`);
  fn(plan);
  plan.updatedAt = nowIso();
  await writeJsonState('ultraplan', state);
  return plan;
}

// ============================================================================
// DEEP LANE
// ============================================================================

export async function processUltraplan(id: string): Promise<UltraplanPlan> {
  const current = await getUltraplan(id);
  if (!current) throw new Error(`Ultraplan ${id} not found`);
  if (current.status === 'planning') return current; // single-flight guard

  const plan = await updatePlan(id, (p) => {
    p.status = 'planning';
    p.error = undefined;
  });

  try {
    const { hasNativeReasoning, callDeepLLM, deepenLoop, parseArtifact } = await import('./cognition');
    const artifact = hasNativeReasoning()
      ? parseArtifact(await callDeepLLM({ system: SYSTEM_PROMPT, userMessage: buildBrief(plan.task) }))
      : await deepenLoop({ system: SYSTEM_PROMPT, userMessage: buildBrief(plan.task) }, 3);
    return updatePlan(id, (p) => {
      p.status = 'plan_ready';
      p.plan = artifact;
      p.error = undefined;
    });
  } catch (err) {
    return updatePlan(id, (p) => {
      p.status = 'failed';
      p.error = err instanceof Error ? err.message.slice(0, 500) : String(err);
    });
  }
}

/** Scheduler handler: drain the oldest queued plan (never rejects). */
export async function processNextUltraplan(): Promise<{ processed: number; id?: string; status?: string; error?: string }> {
  try {
    const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
    const next = [...state.plans]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .find((p) => p.status === 'queued');
    if (!next) return { processed: 0 };
    const done = await processUltraplan(next.id);
    return { processed: 1, id: done.id, status: done.status };
  } catch (err) {
    return { processed: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// APPROVAL
// ============================================================================

export async function approveUltraplan(id: string): Promise<UltraplanPlan & { runAsChainAvailable: boolean }> {
  const plan = await updatePlan(id, (p) => {
    if (p.status !== 'plan_ready') throw new Error(`Ultraplan ${id} is not plan_ready (was ${p.status})`);
    p.status = 'approved';
  });
  await storeMemory({
    agent_id: 'draymond',
    user_id: 'system',
    key: `ultraplan:${id}`,
    summary: `Approved plan: ${plan.task.title}`,
    value: { plan: plan.plan, approvedAt: nowIso() },
    tier: 'important',
    importance_score: 0.8,
    source_event: 'ultraplan_approved',
  }).catch(() => {});
  // Manual "run as chain" follow-up — no auto-execution in v1.
  return { ...plan, runAsChainAvailable: true };
}

export async function rejectUltraplan(id: string): Promise<UltraplanPlan> {
  return updatePlan(id, (p) => {
    if (p.status !== 'plan_ready') throw new Error(`Ultraplan ${id} is not plan_ready (was ${p.status})`);
    p.status = 'rejected';
  });
}

export async function replanUltraplan(id: string, brief: string): Promise<UltraplanPlan> {
  return updatePlan(id, (p) => {
    if (p.status !== 'rejected' && p.status !== 'failed') {
      throw new Error(`Ultraplan ${id} must be rejected or failed to replan (was ${p.status})`);
    }
    p.status = 'queued';
    p.task = { ...p.task, brief };
    p.plan = undefined;
    p.error = undefined;
  });
}

// ============================================================================
// RECOVERY
// ============================================================================

/** Mark `planning` plans older than ULTRAPLAN_STUCK_MS as failed (restart). */
export async function recoverStuckUltraplans(): Promise<{ recovered: number }> {
  const state = await readJsonState<UltraplanState>('ultraplan', DEFAULT_STATE());
  const cutoff = Date.now() - stuckMs();
  let recovered = 0;
  for (const p of state.plans) {
    if (p.status === 'planning' && new Date(p.updatedAt).getTime() < cutoff) {
      p.status = 'failed';
      p.error = 'stuck in planning (timeout)';
      p.updatedAt = nowIso();
      recovered += 1;
    }
  }
  if (recovered > 0) await writeJsonState('ultraplan', state);
  return { recovered };
}
