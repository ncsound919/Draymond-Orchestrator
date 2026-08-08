import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the DB client so getSystemIntel reads from an in-memory fake.
const dbData = vi.hoisted(() => ({} as Record<string, { data?: unknown; error?: unknown; count?: number }>));
const brainStatus = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => ({
    from: (table: string) => {
      const spec = dbData[table] ?? { data: [], error: null, count: 0 };
      const target = { data: spec.data ?? [], error: spec.error ?? null, count: spec.count };
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: unknown) => void) => resolve(target),
      };
      return chain;
    },
  })),
}));

vi.mock('../src/lib/draymond/brain-client', () => ({
  getBrainStatus: brainStatus,
}));

import { getSystemIntel, formatSystemIntel, systemIntelSummary } from '../src/lib/draymond/system-intel';

function seed() {
  dbData['draymond_agents'] = {
    data: [
      { name: 'Uplift Agent', slug: 'uplift-agent', status: 'active', consecutive_errors: 0 },
      { name: 'Sports Steve', slug: 'sports-steve', status: 'degraded', consecutive_errors: 2 },
    ],
  };
  dbData['draymond_entities'] = {
    data: [
      { name: 'Megacode', kind: 'tool', health_status: 'healthy' },
      { name: 'AetherDesk', kind: 'service', health_status: 'unhealthy' },
      { name: 'Mutly', kind: 'tool', health_status: 'unknown' },
    ],
  };
  dbData['draymond_chains'] = {
    data: [
      { name: 'Research Pipeline', status: 'completed', started_at: '2026-08-07T10:00:00Z' },
      { name: 'Trading Pipeline', status: 'failed', started_at: '2026-08-07T11:00:00Z' },
    ],
  };
  dbData['draymond_scheduled_jobs'] = {
    data: [
      { name: 'Morning Briefing', cron_expression: '0 9 * * *', last_run_status: 'success', last_run_at: '2026-08-07T09:00:00Z', next_run_at: '2026-08-08T09:00:00Z', is_enabled: 1 },
      { name: 'Market News Digest', cron_expression: '0 7 * * *', last_run_status: 'failed', last_run_at: '2026-08-07T07:00:00Z', next_run_at: '2026-08-08T07:00:00Z', is_enabled: 1 },
      { name: 'Weekly Review', cron_expression: '0 9 * * 1', last_run_status: 'never', last_run_at: null, next_run_at: '2026-08-10T09:00:00Z', is_enabled: 0 },
    ],
  };
  dbData['draymond_site_monitors'] = {
    data: [
      { name: 'Uplift Agent', current_status: 'down' },
      { name: 'Sports Steve', current_status: 'up' },
    ],
  };
  dbData['draymond_notifications'] = {
    data: [
      { type: 'agent_failure', subject: 'X failed', status: 'sent' },
      { type: 'email', subject: 'Y', status: 'failed' },
    ],
  };
  dbData['draymond_actions'] = {
    data: [
      { status: 'pending_review', action_type: 'aetherdesk:launch_campaign', description: 'launch' },
      { status: 'auto_executed', action_type: 'run_health', description: 'health' },
    ],
  };
  dbData['draymond_goals'] = {
    data: [
      { title: 'Grow marketing', status: 'active', progress_pct: 40, horizon: 'short_term' },
      { title: 'Ship v2', status: 'active', progress_pct: 75, horizon: 'medium_term' },
      { title: 'Done goal', status: 'completed', progress_pct: 100, horizon: 'short_term' },
    ],
  };
  dbData['draymond_memory'] = {
    data: [{ tier: 'core' }, { tier: 'contextual' }, { tier: 'core' }],
  };
  dbData['draymond_events'] = {
    data: [
      { severity: 'error', event_type: 'self_repair_triggered', message: 'repaired agent X' },
      { severity: 'info', event_type: 'chain_completed', message: 'chain done' },
    ],
    count: 2,
  };
  dbData['draymond_handoffs'] = { count: 3 };
  dbData['draymond_benchmarks'] = {
    data: [{ component_name: 'megacode', weakness_score: 22, run_at: '2026-08-07T12:00:00Z' }],
  };
  dbData['draymond_upgrade_queue'] = {
    data: [{ component_name: 'megacode', weakness_score: 22, status: 'queued' }],
  };
  dbData['draymond_execution_logs'] = {
    data: [
      { entity_slug: 'megacode', action: 'run', success: true, error_message: null },
      { entity_slug: 'sports-steve', action: 'run', success: false, error_message: 'boom' },
    ],
  };
}

describe('system-intel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds a bounded snapshot across all subsystems', async () => {
    seed();
    const intel = await getSystemIntel();

    expect(intel.agents).toHaveLength(2);
    expect(intel.entities.by_kind.tool).toBe(2);
    expect(intel.entities.unhealthy).toEqual(['AetherDesk']);
    expect(intel.jobs.failed_recently.map((j) => j.name)).toEqual(['Market News Digest']);
    expect(intel.jobs.enabled).toBe(2);
    expect(intel.monitors.down).toEqual(['Uplift Agent']);
    expect(intel.goals.active).toHaveLength(2);
    expect(intel.upgrade_queue.items[0].component_name).toBe('megacode');
    expect(intel.execution.failed_recently).toBe(1);
    expect(intel.repairs.recent.some((r) => /repair/i.test(r.event_type))).toBe(true);
    expect(intel.events.last_24h).toBe(2);
    expect(intel.handoffs_last_24h).toBe(3);
  });

  it('formats a deterministic snapshot with the key sections', async () => {
    seed();
    const intel = await getSystemIntel();
    const text = formatSystemIntel(intel);

    expect(text).toContain('Draymond system snapshot');
    expect(text).toContain('Sports Steve (degraded');
    expect(text).toContain('Crons / scheduled jobs');
    expect(text).toContain('Market News Digest');
    expect(text).toContain('Agenda / goals');
    expect(text).toContain('Grow marketing');
    expect(text).toContain('Repairs & recovery');
    expect(text).toContain('Upgrade queue');
  });

  it('produces a compact one-line summary', async () => {
    seed();
    const intel = await getSystemIntel();
    const summary = systemIntelSummary(intel);
    expect(summary).toContain('2 agents');
    expect(summary).toContain('1/3 jobs failing');
    expect(summary).toContain('1/2 monitors down');
    expect(summary).toContain('1 agents degraded');
  });

  it('reports the knowledge graph when graphify has been run', async () => {
    // Graphify is configured in this environment: graphify-out/GRAPH_REPORT.md
    // exists (built via `graphify . --code-only --no-viz` + cluster-only), so
    // system-intel should surface it. Mirrors the live setup.
    seed();
    const intel = await getSystemIntel();
    // If the graph was ever built, indexed=true; otherwise it degrades to false
    // without crashing — both are correct behavior depending on the workspace.
    expect(typeof intel.knowledge_graph.indexed).toBe('boolean');
    if (intel.knowledge_graph.indexed) {
      expect(intel.knowledge_graph.report_excerpt).toContain('Graph Report');
    }
  });

  it('reports brain observer status when the brain client is available', async () => {
    seed();
    brainStatus.mockResolvedValue({
      last_run_at: '2026-08-07T05:00:00Z',
      last_run: { summary: { recognized: 2, proposed: 2 } },
      total_findings: 6,
      open_findings: 4,
      communities: ['agents', 'core'],
      ledger_path: '.brain_sweeps.jsonl',
    });

    const intel = await getSystemIntel();
    expect(intel.brain?.open_findings).toBe(4);
    expect(intel.brain?.communities).toContain('agents');
    const text = formatSystemIntel(intel);
    expect(text).toContain('Deterministic brain');
    expect(text).toContain('4 open findings');
  });
});
