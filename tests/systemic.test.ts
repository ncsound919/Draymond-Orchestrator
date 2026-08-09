import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DraymondEntity } from '../src/lib/draymond/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-systemic-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// systemic.ts is imported for real — only its dependencies are mocked. The
// modules it loads dynamically (self-learning, kairos, ultraplan, dream-cycle)
// are factory-mocked with the same specifiers so the dynamic imports resolve
// to mocks too.
vi.mock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: vi.fn() }));
vi.mock('../src/lib/draymond/index', () => ({
  storeMemory: vi.fn(async () => {}),
  createGoal: vi.fn(async () => 'goal-id'),
  updateGoalProgress: vi.fn(async () => {}),
}));
vi.mock('../src/lib/draymond/registry', () => ({
  createRelation: vi.fn(async () => {}),
  getEntity: vi.fn(async () => null),
  searchEntities: vi.fn(async () => []),
}));
vi.mock('../src/lib/draymond/self-learning', () => ({
  recordOutcome: vi.fn(async () => ({})),
  getLessons: vi.fn(async () => []),
  distillLessons: vi.fn(async () => []),
}));
vi.mock('../src/lib/draymond/chains', () => ({
  getChainSteps: vi.fn(async () => []),
  listChains: vi.fn(async () => []),
}));
vi.mock('../src/lib/draymond/kairos', () => ({ startKairos: vi.fn() }));
vi.mock('../src/lib/draymond/ultraplan', () => ({
  enqueueUltraplan: vi.fn(async () => ({})),
  recoverStuckUltraplans: vi.fn(async () => ({ recovered: 0 })),
}));
vi.mock('../src/lib/draymond/dream-cycle', () => ({ runDreamCycle: vi.fn(async () => ({})) }));

// ── Mock supabase query builder ─────────────────────────────────────────────
// createDraymondAdminClient() returns a fluent builder that records which
// tables were queried and what was upserted, resolving per-table results.

type QueryResult = { data?: unknown; error?: unknown; count?: number };

const tableResults = new Map<string, QueryResult>();
const queriedTables: string[] = [];
const upserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

function makeSupabaseClient() {
  return {
    from: (table: string) => {
      queriedTables.push(table);
      const result = tableResults.get(table) ?? { data: null, error: null, count: 0 };
      const builder = {
        then: (resolve: (value: QueryResult) => unknown) => resolve(result),
        catch: (reject: (err: unknown) => unknown) => {
          reject(new Error('query failed'));
          return builder;
        },
        finally: (cb: () => void) => {
          cb();
          return builder;
        },
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        maybeSingle: () => builder,
        single: () => builder,
        gte: () => builder,
        order: () => builder,
        range: () => builder,
        contains: () => builder,
        or: () => builder,
        upsert: (payload: Record<string, unknown>) => {
          upserts.push({ table, payload });
          return builder;
        },
      };
      return builder;
    },
  };
}

// Module-level state (coalescing map, entity caches) forces a fresh module
// instance per test case, following the kairos test pattern.
let systemic: typeof import('../src/lib/draymond/systemic');
let client: { createDraymondAdminClient: Mock };
let indexMod: { storeMemory: Mock; createGoal: Mock; updateGoalProgress: Mock };
let registry: { createRelation: Mock; getEntity: Mock; searchEntities: Mock };
let learning: { recordOutcome: Mock; getLessons: Mock; distillLessons: Mock };
let chains: { getChainSteps: Mock; listChains: Mock };
let kairos: { startKairos: Mock };
let ultraplan: { enqueueUltraplan: Mock; recoverStuckUltraplans: Mock };
let dreamCycle: { runDreamCycle: Mock };

const makeEntity = (overrides: Partial<DraymondEntity> = {}): DraymondEntity => ({
  id: 'e1',
  name: 'draymond',
  slug: 'draymond',
  kind: 'agent',
  description: null,
  version: '1.0.0',
  icon_url: null,
  tags: [],
  category: null,
  sector: null,
  invocation_method: 'internal',
  invocation_config: {},
  capabilities: [],
  input_schema: {},
  output_schema: {},
  depends_on: [],
  source_type: null,
  source_url: null,
  download_path: null,
  is_free: true,
  price_cents: null,
  stripe_link: null,
  is_integrated: false,
  platform_page: null,
  linked_agent_id: null,
  confidence_threshold_override: null,
  risk_level_default: 'low',
  max_retries: 2,
  timeout_seconds: 300,
  is_active: true,
  health_status: 'healthy',
  last_invoked_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

beforeEach(async () => {
  vi.resetModules();
  client = (await import('../src/lib/draymond/client')) as unknown as { createDraymondAdminClient: Mock };
  indexMod = (await import('../src/lib/draymond/index')) as unknown as {
    storeMemory: Mock;
    createGoal: Mock;
    updateGoalProgress: Mock;
  };
  registry = (await import('../src/lib/draymond/registry')) as unknown as {
    createRelation: Mock;
    getEntity: Mock;
    searchEntities: Mock;
  };
  learning = (await import('../src/lib/draymond/self-learning')) as unknown as {
    recordOutcome: Mock;
    getLessons: Mock;
    distillLessons: Mock;
  };
  chains = (await import('../src/lib/draymond/chains')) as unknown as {
    getChainSteps: Mock;
    listChains: Mock;
  };
  kairos = (await import('../src/lib/draymond/kairos')) as unknown as { startKairos: Mock };
  ultraplan = (await import('../src/lib/draymond/ultraplan')) as unknown as {
    enqueueUltraplan: Mock;
    recoverStuckUltraplans: Mock;
  };
  dreamCycle = (await import('../src/lib/draymond/dream-cycle')) as unknown as { runDreamCycle: Mock };
  systemic = await import('../src/lib/draymond/systemic');
  tableResults.clear();
  queriedTables.length = 0;
  upserts.length = 0;
  // resetModules does NOT reset the mock registry — clear call history, then
  // install safe empty defaults so every test starts deterministic.
  vi.clearAllMocks();
  client.createDraymondAdminClient.mockImplementation(() => makeSupabaseClient());
  indexMod.storeMemory.mockResolvedValue(undefined);
  indexMod.createGoal.mockResolvedValue('goal-id');
  indexMod.updateGoalProgress.mockResolvedValue(undefined);
  registry.createRelation.mockResolvedValue(undefined);
  registry.getEntity.mockResolvedValue(null);
  registry.searchEntities.mockResolvedValue([]);
  learning.recordOutcome.mockResolvedValue({} as never);
  learning.getLessons.mockResolvedValue([]);
  learning.distillLessons.mockResolvedValue([]);
  chains.getChainSteps.mockResolvedValue([]);
  chains.listChains.mockResolvedValue([]);
  kairos.startKairos.mockReturnValue(undefined);
  ultraplan.recoverStuckUltraplans.mockResolvedValue({ recovered: 0 });
  ultraplan.enqueueUltraplan.mockResolvedValue({} as never);
  dreamCycle.runDreamCycle.mockResolvedValue({} as never);
});

afterEach(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('systemic identity + agenda', () => {
  it('exposes the system identity constants', () => {
    expect(systemic.SYSTEM_USER_ID).toBe('system');
    expect(systemic.SYSTEM_AGENT_ID).toBe('draymond');
  });

  it('OVERLAY365_AGENDA ships 6 goals with agents, horizons, priorities and criteria', () => {
    const agenda = systemic.OVERLAY365_AGENDA;
    expect(agenda).toHaveLength(6);
    expect(agenda.filter((g) => g.agent_id === 'draymond')).toHaveLength(2);
    for (const goal of agenda) {
      expect(['immediate', 'short_term', 'medium_term', 'long_term']).toContain(goal.horizon);
      expect(goal.priority).toBeGreaterThanOrEqual(0);
      expect(goal.success_criteria.length).toBeGreaterThan(0);
      expect(goal.success_criteria.every((c) => c.met === false)).toBe(true);
    }
    expect(agenda.map((g) => g.title)).toContain('Knowledge graph populated');
    expect(agenda.map((g) => g.title)).toContain('Self-learning loop active');
  });
});

describe('ingestEvent', () => {
  it('ingests a completed chain into learning, memory and the knowledge graph', async () => {
    const draymond = makeEntity({ id: 'e1', name: 'draymond', slug: 'draymond' });
    const deploy = makeEntity({ id: 'e2', name: 'deploy', slug: 'deploy' });
    registry.searchEntities.mockResolvedValue([draymond, deploy]);
    registry.getEntity.mockImplementation(async (slug: string) =>
      slug === 'draymond' ? draymond : slug === 'deploy' ? deploy : null
    );

    await systemic.ingestEvent('chain.completed', {
      chain_name: 'deploy',
      completed_steps: 2,
      duration_ms: 100,
    });

    expect(learning.recordOutcome).toHaveBeenCalledWith({
      agentId: 'draymond:chain',
      kind: 'job',
      summary: 'chain deploy',
      success: true,
      detail: '2/2 steps, 100ms',
    });
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'draymond',
        user_id: 'system',
        key: 'chain:deploy',
        summary: 'Chain deploy completed',
        tier: 'contextual',
        importance_score: 0.4,
        source_event: 'chain.completed',
      })
    );
    const mem = indexMod.storeMemory.mock.calls[0][0] as { value: Record<string, unknown> };
    expect(mem.value).toEqual({
      type: 'chain.completed',
      chain_name: 'deploy',
      completed_steps: 2,
      duration_ms: 100,
    });
    expect(registry.createRelation).toHaveBeenCalledWith({
      source_entity_id: 'e1',
      target_entity_id: 'e2',
      relation_type: 'produced',
      metadata: expect.objectContaining({ event_type: 'chain.completed' }),
    });
  });

  it('maps failure events to the important tier and reported_failure relations', async () => {
    const draymond = makeEntity({ id: 'e1', name: 'draymond', slug: 'draymond' });
    const deploy = makeEntity({ id: 'e2', name: 'deploy', slug: 'deploy' });
    registry.searchEntities.mockResolvedValue([draymond, deploy]);
    registry.getEntity.mockImplementation(async (slug: string) =>
      slug === 'draymond' ? draymond : slug === 'deploy' ? deploy : null
    );

    await systemic.ingestEvent('chain.failed', {
      chain_name: 'deploy',
      error: 'timeout',
      failed_steps: 1,
    });

    expect(learning.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'draymond:chain', kind: 'incident', success: false, summary: 'chain deploy', detail: 'timeout' })
    );
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'chain:deploy',
        summary: 'Chain deploy failed',
        tier: 'important',
        importance_score: 0.8,
      })
    );
    expect(registry.createRelation).toHaveBeenCalledWith(
      expect.objectContaining({ source_entity_id: 'e1', target_entity_id: 'e2', relation_type: 'reported_failure' })
    );
  });

  it('records monitor.site_down under the overlay-auditor identity', async () => {
    const auditor = makeEntity({ id: 'a1', name: 'overlay-auditor', slug: 'overlay-auditor' });
    const site = makeEntity({ id: 's1', name: 'uplift.ai', slug: 'uplift.ai', kind: 'service' });
    registry.searchEntities.mockResolvedValue([auditor, site]);
    registry.getEntity.mockImplementation(async (slug: string) =>
      slug === 'overlay-auditor' ? auditor : slug === 'uplift.ai' ? site : null
    );

    await systemic.ingestEvent('monitor.site_down', {
      monitor_name: 'uplift.ai',
      consecutive_failures: 3,
      status_code: 503,
    });

    expect(learning.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'overlay-auditor:site', kind: 'incident', success: false, summary: 'site uplift.ai', detail: 'down 3x (503)' })
    );
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'overlay-auditor',
        key: 'site:uplift.ai:status',
        summary: 'Site uplift.ai down',
        tier: 'important',
        importance_score: 0.8,
      })
    );
    expect(registry.createRelation).toHaveBeenCalledWith(
      expect.objectContaining({ source_entity_id: 'a1', target_entity_id: 's1', relation_type: 'reported_failure' })
    );
  });

  it('records agent.result with agent-scoped keys and skips a self-relation', async () => {
    const coder = makeEntity({ id: 'c1', name: 'coder', slug: 'coder' });
    registry.searchEntities.mockResolvedValue([coder]);
    registry.getEntity.mockResolvedValue(coder);

    await systemic.ingestEvent('agent.result', {
      entity_name: 'coder',
      success: false,
      error: 'nope',
      duration_ms: 10,
    });

    expect(learning.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'coder:agent', kind: 'job', success: false, summary: 'agent coder', detail: 'nope' })
    );
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'coder', key: 'agent:coder:last', summary: 'Agent coder failed' })
    );
    expect(registry.createRelation).not.toHaveBeenCalled();
  });

  it('maps step, job, notification and recovery events to outcome summaries', async () => {
    const events: Array<[string, Record<string, unknown>]> = [
      ['chain.step_completed', { chain_name: 'deploy', step_name: 'lint', duration_ms: 9 }],
      ['chain.step_failed', { chain_name: 'deploy', step_name: 'lint', error: 'lint broke' }],
      ['scheduler.job_completed', { job_name: 'nightly', duration_ms: 100 }],
      ['scheduler.job_failed', { job_name: 'nightly' }],
      ['monitor.site_recovered', { monitor_name: 'uplift.ai' }],
      ['notification.failed', { subject: 'Digest', error: 'smtp down' }],
      ['notification.sent', { subject: 'Digest', recipient: 'ops@uplift.ai' }],
    ];
    for (const [type, data] of events) {
      await systemic.ingestEvent(type, data);
    }

    const calls = learning.recordOutcome.mock.calls.map((c) => c[0] as { summary: string; detail: string; success: boolean; kind: string; agentId: string });
    const outcome = (summary: string, kind: string) => calls.find((c) => c.summary === summary && c.kind === kind);

    expect(outcome('chain step lint', 'job')).toEqual(
      expect.objectContaining({ agentId: 'draymond:chain', success: true, detail: '9ms' })
    );
    expect(outcome('chain step lint', 'incident')).toEqual(
      expect.objectContaining({ success: false, detail: 'lint broke' })
    );
    expect(outcome('job nightly', 'job')).toEqual(
      expect.objectContaining({ agentId: 'draymond:job', success: true, detail: '100ms' })
    );
    expect(outcome('job nightly', 'incident')).toEqual(
      expect.objectContaining({ success: false, detail: 'job failed' })
    );
    expect(outcome('site uplift.ai', 'repair')).toEqual(
      expect.objectContaining({ agentId: 'overlay-auditor:site', success: true, detail: 'recovered' })
    );
    expect(outcome('notification Digest', 'incident')).toEqual(
      expect.objectContaining({ success: false, detail: 'smtp down' })
    );
    expect(outcome('notification Digest', 'manual')).toEqual(
      expect.objectContaining({ agentId: 'draymond:notification', success: true, detail: 'to ops@uplift.ai' })
    );

    const tiers = indexMod.storeMemory.mock.calls.map((c) => (c[0] as { tier: string }).tier);
    expect(tiers.filter((t) => t === 'important')).toHaveLength(3); // step_failed + job_failed + notification.failed
    expect(tiers.filter((t) => t === 'contextual')).toHaveLength(4);
  });

  it('respects agentId and memoryKey overrides', async () => {
    await systemic.ingestEvent(
      'chain.completed',
      { chain_name: 'deploy', completed_steps: 1, duration_ms: 5 },
      { agentId: 'custom-agent', memoryKey: 'override:key' }
    );

    expect(learning.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'custom-agent:chain' })
    );
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'custom-agent', key: 'override:key' })
    );
  });

  it('is a no-op for unmapped event types', async () => {
    await systemic.ingestEvent('custom.thing', { some: 'data' });
    expect(learning.recordOutcome).not.toHaveBeenCalled();
    expect(indexMod.storeMemory).not.toHaveBeenCalled();
    expect(registry.searchEntities).not.toHaveBeenCalled();
  });

  it('is fail-soft when learning, memory or graph stores throw', async () => {
    learning.recordOutcome.mockRejectedValueOnce(new Error('db down'));
    indexMod.storeMemory.mockRejectedValueOnce(new Error('db down'));
    registry.searchEntities.mockRejectedValueOnce(new Error('registry down'));

    await expect(
      systemic.ingestEvent('chain.completed', { chain_name: 'deploy', completed_steps: 1, duration_ms: 5 })
    ).resolves.toBeUndefined();
    expect(indexMod.storeMemory).toHaveBeenCalled();
    expect(registry.createRelation).not.toHaveBeenCalled();
  });
});

describe('flushCoalesced', () => {
  it('drains an empty write queue without touching any store', async () => {
    await expect(systemic.flushCoalesced()).resolves.toBeUndefined();
    expect(learning.recordOutcome).not.toHaveBeenCalled();
    expect(indexMod.storeMemory).not.toHaveBeenCalled();
  });
});

describe('seedAgenda', () => {
  it('creates every agenda goal when none exist', async () => {
    const r = await systemic.seedAgenda();

    expect(r).toEqual({ created: 6, skipped: 0 });
    expect(indexMod.createGoal).toHaveBeenCalledTimes(6);
    expect(queriedTables.filter((t) => t === 'draymond_goals')).toHaveLength(6);
    expect(indexMod.createGoal).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Weekly growth strategy', agent_id: 'overlay-strategist', priority: 60 })
    );
  });

  it('skips goals that already exist', async () => {
    tableResults.set('draymond_goals', { data: { id: 'g1' } });

    const r = await systemic.seedAgenda();
    expect(r).toEqual({ created: 0, skipped: 6 });
    expect(indexMod.createGoal).not.toHaveBeenCalled();
  });

  it('counts createGoal failures as skipped', async () => {
    indexMod.createGoal.mockRejectedValue(new Error('insert failed'));

    const r = await systemic.seedAgenda();
    expect(r).toEqual({ created: 0, skipped: 6 });
    expect(indexMod.createGoal).toHaveBeenCalledTimes(6);
  });
});

describe('seedKnowledgeGraph', () => {
  it('seeds depends_on and collaborates_with edges from template chains', async () => {
    const e1 = makeEntity({ id: 'e1', name: 'writer', slug: 'writer' });
    const e2 = makeEntity({ id: 'e2', name: 'publisher', slug: 'publisher' });
    chains.listChains.mockResolvedValue([{ id: 'c1', name: 'pipeline' }] as never);
    chains.getChainSteps.mockResolvedValue([
      { id: 's1', entity_id: 'e1', name: 'step1', depends_on_steps: [] },
      { id: 's2', entity_id: 'e2', name: 'step2', depends_on_steps: ['s1'] },
    ] as never);
    registry.getEntity.mockImplementation(async (id: string) =>
      id === 'e1' || id === 's1' ? e1 : id === 'e2' || id === 's2' ? e2 : null
    );
    registry.searchEntities.mockResolvedValue([{ ...e1, depends_on: ['e2'] }]);

    const r = await systemic.seedKnowledgeGraph();

    expect(r.relations).toBe(3);
    expect(upserts.map((u) => u.payload.relation_type)).toEqual(['depends_on', 'collaborates_with', 'depends_on']);
    expect(upserts[0]!.payload).toMatchObject({
      source_entity_id: 'e1',
      target_entity_id: 'e2',
      metadata: { chain: 'pipeline', step: 'step2' },
    });
    expect(upserts[1]!.payload).toMatchObject({
      source_entity_id: 'e1',
      target_entity_id: 'e2',
      metadata: { chain: 'pipeline' },
    });
    expect(upserts[2]!.payload).toMatchObject({
      source_entity_id: 'e2',
      target_entity_id: 'e1',
      metadata: {},
    });
    expect(queriedTables.filter((t) => t === 'draymond_entity_relations')).toHaveLength(3);
  });

  it('returns zero relations when there are no templates or dependencies', async () => {
    const r = await systemic.seedKnowledgeGraph();
    expect(r).toEqual({ relations: 0 });
    expect(upserts).toHaveLength(0);
  });

  it('survives failing chain and step reads', async () => {
    chains.listChains.mockResolvedValue([{ id: 'c1', name: 'pipeline' }] as never);
    chains.getChainSteps.mockRejectedValue(new Error('boom'));

    await expect(systemic.seedKnowledgeGraph()).resolves.toEqual({ relations: 0 });
    expect(upserts).toHaveLength(0);
  });

  it('skips self-relations when source and target match', async () => {
    const e1 = makeEntity({ id: 'e1', name: 'writer', slug: 'writer' });
    chains.listChains.mockResolvedValue([{ id: 'c1', name: 'pipeline' }] as never);
    chains.getChainSteps.mockResolvedValue([
      { id: 's1', entity_id: 'e1', name: 'step1', depends_on_steps: ['s1'] },
    ] as never);
    registry.getEntity.mockImplementation(async (id: string) => (id === 'e1' || id === 's1' ? e1 : null));

    const r = await systemic.seedKnowledgeGraph();
    expect(r.relations).toBe(0);
    expect(upserts).toHaveLength(0);
  });
});

describe('consolidateSystem', () => {
  it('persists distilled lessons as important memories', async () => {
    learning.distillLessons.mockResolvedValue([
      { id: 'l1', agentId: 'coder:sub', pattern: 'p1', lesson: 'Lesson one', evidenceCount: 3, lastSeen: 'x' },
      { id: 'l2', agentId: 'planner', pattern: 'p2', lesson: 'Lesson two', evidenceCount: 2, lastSeen: 'x' },
    ] as never);

    const r = await systemic.consolidateSystem();

    expect(r).toEqual({ lessons: 2, memories: 2, goalsUpdated: 0, goalProgress: [] });
    expect(indexMod.storeMemory).toHaveBeenCalledTimes(2);
    expect(indexMod.storeMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'coder',
        user_id: 'system',
        key: 'lesson:l1',
        summary: 'Lesson one',
        tier: 'important',
        importance_score: 0.7,
        source_event: 'lesson_distilled',
      })
    );
    const mem = indexMod.storeMemory.mock.calls[0][0] as { value: Record<string, unknown> };
    expect(mem.value).toEqual({ pattern: 'p1', evidenceCount: 3 });
  });

  it('advances signal goals from relations and lesson counts', async () => {
    learning.distillLessons.mockResolvedValue([
      { id: 'l1', agentId: 'draymond', pattern: 'p1', lesson: 'Lesson one', evidenceCount: 2, lastSeen: 'x' },
      { id: 'l2', agentId: 'draymond', pattern: 'p2', lesson: 'Lesson two', evidenceCount: 1, lastSeen: 'x' },
    ] as never);
    tableResults.set('draymond_goals', {
      data: [{ id: 'g1', title: 'Knowledge graph populated', progress_pct: 10, success_criteria: [] }],
    });
    tableResults.set('draymond_entity_relations', { data: [], count: 30 });

    const r = await systemic.consolidateSystem();

    expect(r.goalsUpdated).toBe(1);
    expect(indexMod.updateGoalProgress).toHaveBeenCalledWith('g1', 100);
    expect(r.goalProgress).toEqual([{ title: 'Knowledge graph populated', progress: 100 }]);
  });

  it('boots non-signal goals to 25% when recent audit events exist', async () => {
    tableResults.set('draymond_goals', {
      data: [{ id: 'g2', title: 'Weekly growth strategy', progress_pct: 0, success_criteria: [{ description: 'Brief produced', met: false }] }],
    });
    tableResults.set('draymond_events', { data: [], count: 5 });

    const r = await systemic.consolidateSystem();

    expect(r.goalsUpdated).toBe(1);
    expect(indexMod.updateGoalProgress).toHaveBeenCalledWith('g2', 25, [{ description: 'Brief produced', met: false }]);
    expect(r.goalProgress).toEqual([{ title: 'Weekly growth strategy', progress: 25 }]);
  });

  it('leaves goals untouched without recent audit signal', async () => {
    tableResults.set('draymond_goals', {
      data: [{ id: 'g2', title: 'Weekly growth strategy', progress_pct: 0, success_criteria: [{ description: 'Brief produced', met: false }] }],
    });
    tableResults.set('draymond_events', { data: [], count: 0 });

    const r = await systemic.consolidateSystem();

    expect(r.goalsUpdated).toBe(0);
    expect(indexMod.updateGoalProgress).not.toHaveBeenCalled();
    expect(r.goalProgress).toEqual([{ title: 'Weekly growth strategy', progress: 0 }]);
  });
});

describe('interconnectSystem', () => {
  it('runs seed + consolidation and returns the combined summary', async () => {
    const r = await systemic.interconnectSystem();

    expect(r).toEqual({
      agenda: { created: 6, skipped: 0 },
      graph: { relations: 0 },
      consolidation: { lessons: 0, memories: 0, goalsUpdated: 0, goalProgress: [] },
    });
    expect(indexMod.createGoal).toHaveBeenCalledTimes(6);
  });
});

describe('cognition orchestration surface', () => {
  it('startCognition boots Kairos and recovers stuck ultraplans', async () => {
    await systemic.startCognition();
    expect(kairos.startKairos).toHaveBeenCalledTimes(1);
    expect(ultraplan.recoverStuckUltraplans).toHaveBeenCalledTimes(1);
  });

  it('startCognition survives a failing ultraplan recovery', async () => {
    ultraplan.recoverStuckUltraplans.mockRejectedValueOnce(new Error('boom'));
    await expect(systemic.startCognition()).resolves.toBeUndefined();
    expect(kairos.startKairos).toHaveBeenCalledTimes(1);
  });

  it('runDreamCycle delegates to the AutoDream cycle', async () => {
    const report = { done: true, cycles: 1 };
    dreamCycle.runDreamCycle.mockResolvedValue(report as never);
    await expect(systemic.runDreamCycle()).resolves.toBe(report);
    expect(dreamCycle.runDreamCycle).toHaveBeenCalledTimes(1);
  });

  it('enqueueUltraplan delegates to the ultraplan module', async () => {
    const plan = { status: 'queued', id: 'up_1' };
    ultraplan.enqueueUltraplan.mockResolvedValue(plan as never);
    await expect(systemic.enqueueUltraplan({ title: 'Task', brief: 'Brief' })).resolves.toBe(plan);
    expect(ultraplan.enqueueUltraplan).toHaveBeenCalledWith({ title: 'Task', brief: 'Brief' });
  });
});
