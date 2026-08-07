import { describe, expect, it, vi } from 'vitest';
import { proposeActions } from '../src/lib/draymond/upgrade-queue';

describe('upgrade queue', () => {
  it('proposes a restart action for a down site', () => {
    const action = proposeActions('site', 'site-down', ['down status', '6 consecutive failures']);
    expect(action.toLowerCase()).toContain('restart');
  });

  it('proposes model/re-register action for a crashed entity', () => {
    const action = proposeActions('entity', 'entity-crashed', ['crashed health', 'error rate 90%']);
    expect(action.toLowerCase()).toMatch(/re-register|reconfigure|model|repair/);
  });

  it('proposes repair-team handoff for a failing cron', () => {
    const action = proposeActions('cron', 'cron-fail', ['failure rate 80%', 'last run failed']);
    expect(action.toLowerCase()).toContain('repair-team');
  });

  it('proposes chain config review for a failing chain', () => {
    const action = proposeActions('chain', 'chain-fail', ['50% failed steps']);
    expect(action.toLowerCase()).toContain('config');
  });

  it('queues the weakest N components', async () => {
    const items: unknown[] = [];
    // queueWeakest does an explicit update-or-insert (the queue table's unique
    // index is partial, so PostgREST upsert-on-conflict can't match it): it
    // first looks up an existing queued row, then inserts/updates. The mock
    // exposes the fluent chain that path uses; no queued row exists so the
    // insert path is exercised.
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn((row: unknown) => {
            items.push(row);
            return { error: null };
          }),
          update: vi.fn(() => builder),
        };
        return builder;
      }),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { queueWeakest: qw } = await import('../src/lib/draymond/upgrade-queue');
    const ranked = [
      { component_class: 'entity' as const, component_slug: 'a', component_name: 'A', score: 90, reasons: ['x'], trend: 'worsening' as const },
      { component_class: 'entity' as const, component_slug: 'b', component_name: 'B', score: 10, reasons: [], trend: 'flat' as const },
    ];
    const res = await qw(ranked as never, 1);
    expect(res.queued).toBe(1);
    expect(items).toHaveLength(1);
  });
});
