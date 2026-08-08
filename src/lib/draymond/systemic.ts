// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Systemic Interconnection Layer
// ============================================================================
// Automatically wires every subsystem event (chains, scheduler jobs, agent
// invocations, site monitors, notifications) into Draymond's persistent stores:
//
//   1. Memory          — draymond_memory (storeMemory)
//   2. Self-learning   — learning outcomes + lessons (recordOutcome / distill)
//   3. Knowledge graph — draymond_entity_relations (createRelation)
//   4. Agenda          — draymond_goals (createGoal / updateGoalProgress)
//
// It hooks the single choke point in event-bridge.emit() so NO per-tool
// integration is needed: any subsystem that already emits events gets
// interconnected automatically.
//
// Design principles:
//   - Best-effort / fail-soft: a store that errors never breaks the caller.
//   - Deterministic keys: memory keys are stable (entity/chain/job/monitor).
//   - Debounced writes: the event bridge fires a lot; we coalesce per key.
// ============================================================================

import { createDraymondAdminClient } from './client';
import { storeMemory, createGoal, updateGoalProgress } from './index';
import { createRelation, getEntity, searchEntities } from './registry';
import { recordOutcome } from './self-learning';
import { getLessons } from './self-learning';
import { getChainSteps } from './chains';
import { listChains } from './chains';
import type { DraymondEntity } from './types';

// ============================================================================
// SYSTEM IDENTITY
// ============================================================================

/** System user — all memory rows are owned by this id. */
export const SYSTEM_USER_ID = 'system';
/** System agent — used for system-level memory / goals. */
export const SYSTEM_AGENT_ID = 'draymond';

// ============================================================================
// IN-MEMORY COALESCING
// ============================================================================

const _writes = new Map<string, { agent: string; type: string; data: Record<string, unknown>; ts: number }>();
const _coalesceMs = 5_000;
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function coalesced(key: string, agent: string, type: string, data: Record<string, unknown>): void {
  _writes.set(key, { agent, type, data, ts: Date.now() });
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushCoalesced().catch(() => {});
    }, _coalesceMs);
  }
}

/** Flush all pending coalesced writes (best-effort). */
export async function flushCoalesced(): Promise<void> {
  const pending = [..._writes.entries()];
  _writes.clear();
  for (const [key, w] of pending) {
    try {
      await ingestEvent(w.type, w.data, { agentId: w.agent, memoryKey: key });
    } catch {
      // best-effort: never break the caller
    }
  }
}

// ============================================================================
// EVENT → STORE MAPPING
// ============================================================================

const kindByEvent: Record<string, 'job' | 'qa' | 'incident' | 'repair' | 'benchmark' | 'manual'> = {
  'chain.step_completed': 'job',
  'chain.step_failed': 'incident',
  'chain.completed': 'job',
  'chain.failed': 'incident',
  'agent.result': 'job',
  'scheduler.job_completed': 'job',
  'scheduler.job_failed': 'incident',
  'monitor.site_down': 'incident',
  'monitor.site_recovered': 'repair',
  'notification.sent': 'manual',
  'notification.failed': 'incident',
};

/** Map an event to { success, summary, detail } for the learning outcome. */
function outcomeOf(type: string, data: Record<string, unknown>): { success: boolean; summary: string; detail: string } | null {
  switch (type) {
    case 'chain.completed':
      return { success: true, summary: `chain ${data.chain_name}`, detail: `${data.completed_steps}/${data.completed_steps ?? 0} steps, ${data.duration_ms}ms` };
    case 'chain.failed':
      return { success: false, summary: `chain ${data.chain_name}`, detail: String(data.error ?? `${data.failed_steps} steps failed`) };
    case 'chain.step_completed':
      return { success: true, summary: `chain step ${data.step_name}`, detail: `${data.duration_ms}ms` };
    case 'chain.step_failed':
      return { success: false, summary: `chain step ${data.step_name}`, detail: String(data.error ?? 'step failed') };
    case 'agent.result':
      return { success: Boolean(data.success), summary: `agent ${data.entity_name}`, detail: String(data.error ?? `${data.duration_ms}ms`) };
    case 'scheduler.job_completed':
      return { success: true, summary: `job ${data.job_name}`, detail: `${data.duration_ms}ms` };
    case 'scheduler.job_failed':
      return { success: false, summary: `job ${data.job_name}`, detail: String(data.error ?? 'job failed') };
    case 'monitor.site_down':
      return { success: false, summary: `site ${data.monitor_name}`, detail: `down ${data.consecutive_failures}x (${data.status_code})` };
    case 'monitor.site_recovered':
      return { success: true, summary: `site ${data.monitor_name}`, detail: 'recovered' };
    case 'notification.sent':
      return { success: true, summary: `notification ${data.subject}`, detail: `to ${data.recipient}` };
    case 'notification.failed':
      return { success: false, summary: `notification ${data.subject}`, detail: String(data.error ?? 'send failed') };
    default:
      return null;
  }
}

/** Derive a stable memory key + agent for an event. */
function memoryKeyOf(type: string, data: Record<string, unknown>): { agent: string; key: string; summary: string } | null {
  switch (type) {
    case 'chain.completed':
    case 'chain.failed':
      return { agent: SYSTEM_AGENT_ID, key: `chain:${data.chain_name}`, summary: `Chain ${data.chain_name} ${type === 'chain.completed' ? 'completed' : 'failed'}` };
    case 'chain.step_completed':
    case 'chain.step_failed':
      return { agent: SYSTEM_AGENT_ID, key: `chain:${data.chain_name}:${data.step_name}`, summary: `Step ${data.step_name} ${type === 'chain.step_completed' ? 'ok' : 'failed'}` };
    case 'agent.result':
      return { agent: String(data.entity_name ?? 'agent'), key: `agent:${data.entity_name}:last`, summary: `Agent ${data.entity_name} ${data.success ? 'ok' : 'failed'}` };
    case 'scheduler.job_completed':
    case 'scheduler.job_failed':
      return { agent: SYSTEM_AGENT_ID, key: `job:${data.job_name}`, summary: `Job ${data.job_name} ${type === 'scheduler.job_completed' ? 'ok' : 'failed'}` };
    case 'monitor.site_down':
    case 'monitor.site_recovered':
      return { agent: 'overlay-auditor', key: `site:${data.monitor_name}:status`, summary: `Site ${data.monitor_name} ${type === 'monitor.site_down' ? 'down' : 'recovered'}` };
    case 'notification.sent':
    case 'notification.failed':
      return { agent: SYSTEM_AGENT_ID, key: `notification:${data.subject}`, summary: `Notification ${data.subject}` };
    default:
      return null;
  }
}

/** Entity name ↔ slug resolution cache (memory + graph). */
const _entityBySlug = new Map<string, DraymondEntity | null>();
const _slugByLowerName = new Map<string, string>();

async function entityBySlug(slug: string): Promise<DraymondEntity | null> {
  if (_entityBySlug.has(slug)) return _entityBySlug.get(slug) ?? null;
  const e = await getEntity(slug).catch(() => null);
  _entityBySlug.set(slug, e);
  return e;
}

async function entityByLabel(label: string): Promise<DraymondEntity | null> {
  const slug = _slugByLowerName.get(label.toLowerCase());
  if (slug) return entityBySlug(slug);
  try {
    const list = await searchEntities({ limit: 500 });
    for (const e of list) {
      _slugByLowerName.set(e.name.toLowerCase(), e.slug);
      _slugByLowerName.set(e.slug.toLowerCase(), e.slug);
    }
    const found = _slugByLowerName.get(label.toLowerCase());
    return found ? entityBySlug(found) : null;
  } catch {
    return null;
  }
}

// ============================================================================
// CORE: ingest one event into all stores
// ============================================================================

/**
 * Ingest a single event into memory, self-learning, and the knowledge graph.
 * Hooked from event-bridge.emit(). Best-effort: never throws.
 */
export async function ingestEvent(
  type: string,
  data: Record<string, unknown>,
  opts: { agentId?: string; memoryKey?: string } = {}
): Promise<void> {
  const mem = memoryKeyOf(type, data);
  if (!mem) return; // unmapped event type — nothing to persist

  const agentId = opts.agentId ?? mem.agent;

  // ── 1. Self-learning outcome ─────────────────────────────────────────
  const outcome = outcomeOf(type, data);
  if (outcome) {
    await recordOutcome({
      agentId: `${agentId}:${mem.key.split(':')[0] ?? 'event'}`.slice(0, 120),
      kind: kindByEvent[type] ?? 'job',
      summary: outcome.summary,
      success: outcome.success,
      detail: outcome.detail,
    }).catch(() => {});
  }

  // ── 2. Memory ────────────────────────────────────────────────────────
  const tier = /failed|down|blocked/.test(type) ? 'important' : 'contextual';
  await storeMemory({
    agent_id: agentId,
    user_id: SYSTEM_USER_ID,
    key: opts.memoryKey ?? mem.key,
    summary: mem.summary,
    value: { type, ...data },
    tier: tier as 'important' | 'contextual',
    importance_score: type.includes('failed') || type === 'monitor.site_down' ? 0.8 : 0.4,
    source_event: type,
  }).catch(() => {});

  // ── 3. Knowledge graph — link the actor entity to what it touched ────
  const actor = await entityByLabel(agentId).catch(() => null);
  const subject = await subjectEntity(type, data).catch(() => null);
  if (actor && subject && actor.id !== subject.id) {
    const relationType = type.includes('failed') || type === 'monitor.site_down'
      ? 'reported_failure'
      : type.includes('completed')
        ? 'produced'
        : 'invoked';
    await createRelation({
      source_entity_id: actor.id,
      target_entity_id: subject.id,
      relation_type: relationType,
      metadata: { event_type: type, ts: new Date().toISOString() },
    }).catch(() => {});
  }
}

/** Resolve the "subject" entity of an event (the thing being acted on). */
async function subjectEntity(type: string, data: Record<string, unknown>): Promise<DraymondEntity | null> {
  const name =
    data.entity_name ??
    data.monitor_name ??
    data.chain_name ??
    data.job_name ??
    data.subject ??
    '';
  if (!name) return null;
  // Chain/job names aren't entities; map them to their primary entity when possible.
  const e = await entityByLabel(String(name)).catch(() => null);
  return e;
}

// ============================================================================
// AGENDA — seed goals from the Overlay365 agenda
// ============================================================================

export interface AgendaGoal {
  agent_id: string;
  title: string;
  description: string;
  horizon: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  priority: number;
  success_criteria: Array<{ description: string; met: boolean }>;
}

/** The Overlay365 operating agenda — each goal maps to an agent + success signal. */
export const OVERLAY365_AGENDA: AgendaGoal[] = [
  {
    agent_id: 'overlay-strategist',
    title: 'Weekly growth strategy',
    description: 'Strategist runs bi-weekly product/growth analysis; produce recommendations that feed the marketing pipeline.',
    horizon: 'short_term',
    priority: 60,
    success_criteria: [
      { description: 'Strategist brief produced this week', met: false },
      { description: 'Recommendations wired into marketing jobs', met: false },
    ],
  },
  {
    agent_id: 'overlay-treasurer',
    title: 'Weekly financial health pulse',
    description: 'Treasurer reconciles cash, flags anomalies, and reports a CashPulse every week.',
    horizon: 'short_term',
    priority: 70,
    success_criteria: [
      { description: 'CashPulse generated this week', met: false },
      { description: 'Anomalies surfaced to the sync memo', met: false },
    ],
  },
  {
    agent_id: 'overlay-guardian',
    title: 'Legal & compliance monitoring',
    description: 'Guardian watches flagged content and legal risk; any flag must be surfaced within 24h.',
    horizon: 'medium_term',
    priority: 50,
    success_criteria: [
      { description: 'Flagged content checked daily', met: false },
      { description: 'Actionable legal flags escalated', met: false },
    ],
  },
  {
    agent_id: 'overlay-auditor',
    title: 'System integrity & uptime',
    description: 'Auditor runs site health checks, catches broken links and downtime, and drives repair.',
    horizon: 'short_term',
    priority: 80,
    success_criteria: [
      { description: 'All overlay sites passing QA', met: false },
      { description: 'Downtime repaired within the day', met: false },
    ],
  },
  {
    agent_id: 'draymond',
    title: 'Self-learning loop active',
    description: 'Every subsystem outcome is recorded, lessons distilled, and the loop feeds back into repair.',
    horizon: 'long_term',
    priority: 90,
    success_criteria: [
      { description: 'Outcomes recorded from all subsystems', met: false },
      { description: 'Lessons distilled nightly', met: false },
    ],
  },
  {
    agent_id: 'draymond',
    title: 'Knowledge graph populated',
    description: 'Entities, chains, jobs, and monitors are wired as relations so the brain can reason over them.',
    horizon: 'medium_term',
    priority: 70,
    success_criteria: [
      { description: 'Entity relations seeded', met: false },
      { description: 'Relations auto-added on every event', met: false },
    ],
  },
];

/** Seed the agenda (idempotent — skips goals with the same title). */
export async function seedAgenda(): Promise<{ created: number; skipped: number }> {
  const supabase = createDraymondAdminClient();
  let created = 0;
  let skipped = 0;
  for (const g of OVERLAY365_AGENDA) {
    const exists = await supabase
      .from('draymond_goals')
      .select('id')
      .eq('title', g.title)
      .limit(1)
      .maybeSingle();
    if (exists.data) {
      skipped++;
      continue;
    }
    try {
      await createGoal(g);
      created++;
    } catch {
      skipped++;
    }
  }
  return { created, skipped };
}

// ============================================================================
// KNOWLEDGE GRAPH — seed relations from chain templates + entity deps
// ============================================================================

/**
 * Seed the knowledge graph: for every chain template, connect each step's
 * entity to the entities it depends on (data flows), and add explicit entity
 * dependency edges. Idempotent (upsert on the relation triple).
 */
export async function seedKnowledgeGraph(): Promise<{ relations: number }> {
  const supabase = createDraymondAdminClient();
  let relations = 0;

  const upsert = async (sourceId: string, targetId: string, type: string, metadata: Record<string, unknown>): Promise<void> => {
    if (sourceId === targetId) return;
    const { error } = await supabase.from('draymond_entity_relations').upsert(
      {
        source_entity_id: sourceId,
        target_entity_id: targetId,
        relation_type: type,
        metadata,
      },
      { onConflict: 'source_entity_id,target_entity_id,relation_type' }
    );
    if (!error) relations++;
  };

  // ── Chain templates → data-flow edges between step entities ──────────
  const chains = await listChains({ is_template: true }).catch(() => []);
  for (const chain of chains) {
    const steps = await getChainSteps(chain.id).catch(() => []);
    const entitiesInChain = new Map<string, { id: string; name: string }>();
    for (const step of steps) {
      const entity = await getEntity(step.entity_id).catch(() => null);
      if (entity) entitiesInChain.set(entity.id, { id: entity.id, name: entity.name });
    }
    const ids = [...entitiesInChain.values()];

    // A step depends on its declared dependencies → data flows dep → step.
    for (const step of steps) {
      const stepEntity = await getEntity(step.entity_id).catch(() => null);
      if (!stepEntity) continue;
      for (const depId of step.depends_on_steps ?? []) {
        const depEntity = await getEntity(depId).catch(() => null);
        if (depEntity) {
          await upsert(depEntity.id, stepEntity.id, 'depends_on', { chain: chain.name, step: step.name });
        }
      }
    }

    // Entities in the same chain collaborate (edge both ways is implied by
    // one "collaborates_with" relation per unordered pair — keep it sparse by
    // linking each entity to the next in step order).
    if (ids.length >= 2) {
      for (let i = 0; i < ids.length - 1; i++) {
        await upsert(ids[i].id, ids[i + 1].id, 'collaborates_with', { chain: chain.name });
      }
    }
  }

  // ── Entity dependency edges ──────────────────────────────────────────
  const entities = await searchEntities({ limit: 500 }).catch(() => []);
  for (const e of entities) {
    for (const depSlug of e.depends_on ?? []) {
      const dep = await getEntity(depSlug).catch(() => null);
      if (!dep) continue;
      await upsert(dep.id, e.id, 'depends_on', {});
    }
  }

  return { relations };
}

// ============================================================================
// CONSOLIDATION — distill lessons, persist to memory, align goals
// ============================================================================

/**
 * Run the nightly consolidation:
 *   1. Distill lessons from recorded outcomes
 *   2. Persist each lesson as a memory (so the fleet can retrieve it)
 *   3. Update agenda goal progress based on real signal
 * Returns a summary for the scheduler / dashboard.
 */
export async function consolidateSystem(): Promise<{
  lessons: number;
  memories: number;
  goalsUpdated: number;
  goalProgress: Array<{ title: string; progress: number }>;
}> {
  const { distillLessons } = await import('./self-learning');
  const lessons = await distillLessons(300).catch(() => []);

  let memories = 0;
  for (const l of lessons) {
    await storeMemory({
      agent_id: l.agentId.split(':')[0] || SYSTEM_AGENT_ID,
      user_id: SYSTEM_USER_ID,
      key: `lesson:${l.id}`,
      summary: l.lesson,
      value: { pattern: l.pattern, evidenceCount: l.evidenceCount },
      tier: 'important',
      importance_score: 0.7,
      source_event: 'lesson_distilled',
    }).catch(() => {});
    memories++;
  }

  // ── Agenda alignment: update goal progress from real signals ─────────
  const supabase = createDraymondAdminClient();
  const { data: goals } = await supabase
    .from('draymond_goals')
    .select('id, title, progress_pct, success_criteria')
    .limit(50);

  let goalsUpdated = 0;
  const goalProgress: Array<{ title: string; progress: number }> = [];

  for (const g of (goals ?? []) as Array<{ id: string; title: string; progress_pct: number; success_criteria: Array<{ description: string; met: boolean }> }>) {
    let progress = g.progress_pct ?? 0;
    const criteria = Array.isArray(g.success_criteria) ? g.success_criteria : [];

    if (/Self-learning|Knowledge graph|System integrity/.test(g.title)) {
      // Advance by real measured signal: relations + lessons + monitors.
      const { count: relationsCount } = await supabase
        .from('draymond_entity_relations')
        .select('id', { count: 'exact', head: true });
      const relationSignal = (relationsCount ?? 0) / 10; // 10 relations = full
      const lessonSignal = Math.min(1, lessons.length / 20); // 20 lessons = full
      const signal =
        g.title.includes('Knowledge graph') ? relationSignal
        : g.title.includes('Self-learning') ? Math.max(lessonSignal, relationSignal * 0.5)
        : Math.min(1, relationSignal + lessonSignal);
      const next = Math.round(Math.min(100, Math.max(progress, signal * 100)));
      if (next !== progress) {
        await updateGoalProgress(g.id, next).catch(() => {});
        goalsUpdated++;
        progress = next;
      }
    } else {
      // Non-signal goals: mark criteria met from the audit trail signal.
      const { count: recentCount } = await supabase
        .from('draymond_events')
        .select('event_type', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
      if ((recentCount ?? 0) > 0 && criteria.length > 0 && progress < 25) {
        await updateGoalProgress(g.id, 25, criteria.map((c) => ({ ...c }))).catch(() => {});
        goalsUpdated++;
        progress = 25;
      }
    }
    goalProgress.push({ title: g.title, progress });
  }

  return { lessons: lessons.length, memories, goalsUpdated, goalProgress };
}

// ============================================================================
// ONE-SHOT: full interconnect (seed + consolidate)
// ============================================================================

/** Seed agenda + knowledge graph + run consolidation. Idempotent. */
export async function interconnectSystem(): Promise<{
  agenda: { created: number; skipped: number };
  graph: { relations: number };
  consolidation: { lessons: number; memories: number; goalsUpdated: number };
}> {
  const agenda = await seedAgenda();
  const graph = await seedKnowledgeGraph();
  const consolidation = await consolidateSystem();
  return { agenda, graph, consolidation };
}
