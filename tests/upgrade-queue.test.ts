import { describe, expect, it, vi } from 'vitest';
import { proposeActions } from '../src/lib/draymond/upgrade-queue';
import type { WeaknessScore } from '../src/lib/draymond/types';

async function loadUpgradeQueueModule(client: unknown) {
  vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => client }));
  vi.resetModules();
  return import('../src/lib/draymond/upgrade-queue');
}

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

  it('refreshes an existing queued row via update (created_at not overwritten)', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'abc', created_at: '2026-01-01T00:00:00.000Z' },
            error: null,
          })),
          insert: vi.fn(() => ({ error: null })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return { eq: vi.fn(async () => ({ error: null })) };
          }),
        };
        return builder;
      }),
    };
    const { queueWeakest: qw } = await loadUpgradeQueueModule(supabase);
    const ranked: WeaknessScore[] = [
      { component_class: 'entity', component_slug: 'a', component_name: 'A', score: 90, reasons: ['x'], trend: 'worsening' },
    ];
    const deepScores = { a: { 'vibe-reality': { scorer: 'vibe-reality', score: 20, summary: 's' } } };
    const res = await qw(ranked, 1, deepScores);
    expect(res).toEqual({ queued: 1, skipped: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      component_name: 'A',
      weakness_score: 90,
      reasons: ['x'],
      proposed_action: expect.stringMatching(/reconfigure/i),
      deep_scores: { 'vibe-reality': { scorer: 'vibe-reality', score: 20, summary: 's' } },
    });
    expect(updates[0]).not.toHaveProperty('created_at');
  });

  it('preserves stored deep scores on update when none are provided', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'abc', created_at: '2026-01-01T00:00:00.000Z' },
            error: null,
          })),
          insert: vi.fn(() => ({ error: null })),
          update: vi.fn((payload: Record<string, unknown>) => {
            updates.push(payload);
            return { eq: vi.fn(async () => ({ error: null })) };
          }),
        };
        return builder;
      }),
    };
    const { queueWeakest: qw } = await loadUpgradeQueueModule(supabase);
    const ranked: WeaknessScore[] = [
      { component_class: 'entity', component_slug: 'a', component_name: 'A', score: 90, reasons: ['x'], trend: 'worsening' },
    ];
    // No deepScores passed (e.g. a Mon/Wed/Fri run that doesn't deep-score).
    const res = await qw(ranked, 1);
    expect(res).toEqual({ queued: 1, skipped: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty('deep_scores');
  });

  it('skips an item when the queued-row lookup fails', async () => {
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
          insert: vi.fn(() => ({ error: null })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        };
        return builder;
      }),
    };
    const { queueWeakest: qw } = await loadUpgradeQueueModule(supabase);
    const ranked: WeaknessScore[] = [
      { component_class: 'entity', component_slug: 'a', component_name: 'A', score: 90, reasons: ['x'], trend: 'worsening' },
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await qw(ranked, 1);
    expect(res).toEqual({ queued: 0, skipped: 1 });
    consoleError.mockRestore();
  });

  it('respects limit and queues the highest-scored items first', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn((row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          }),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        };
        return builder;
      }),
    };
    const { queueWeakest: qw } = await loadUpgradeQueueModule(supabase);
    const ranked: WeaknessScore[] = [
      { component_class: 'entity', component_slug: 'low', component_name: 'Low', score: 10, reasons: ['z'], trend: 'flat' },
      { component_class: 'entity', component_slug: 'high', component_name: 'High', score: 90, reasons: ['a'], trend: 'worsening' },
      { component_class: 'entity', component_slug: 'mid', component_name: 'Mid', score: 50, reasons: ['b'], trend: 'flat' },
    ];
    const res = await qw(ranked, 2);
    expect(res).toEqual({ queued: 2, skipped: 0 });
    expect(inserted).toHaveLength(2);
    expect(inserted.map((r) => r.weakness_score)).toEqual([90, 50]);
  });

  it('queues nothing for an empty ranked list', async () => {
    const { queueWeakest: qw } = await loadUpgradeQueueModule({ from: vi.fn() });
    await expect(qw([], 5)).resolves.toEqual({ queued: 0, skipped: 0 });
  });

  it('excludes healthy (score 0) components from the queue', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn((row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          }),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        };
        return builder;
      }),
    };
    const { queueWeakest: qw } = await loadUpgradeQueueModule(supabase);
    const ranked: WeaknessScore[] = [
      { component_class: 'entity', component_slug: 'weak', component_name: 'Weak', score: 80, reasons: ['x'], trend: 'worsening' },
      { component_class: 'entity', component_slug: 'healthy', component_name: 'Healthy', score: 0, reasons: [], trend: 'flat' },
    ];
    const res = await qw(ranked, 5);
    expect(res).toEqual({ queued: 1, skipped: 0 });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].component_slug).toBe('weak');
  });

  it('proposes routing/TLS review for a site with an unrelated reason', () => {
    const action = proposeActions('site', 'site-slow', ['latency 3000ms exceeds 2s budget']);
    expect(action.toLowerCase()).toMatch(/routing|tls/);
  });

  it('proposes reconfigure for an entity with a non-crashed reason', () => {
    const action = proposeActions('entity', 'entity-stale', ['stale (30 days since invocation)']);
    expect(action.toLowerCase()).toContain('reconfigure');
  });

  it('marks a queue item completed with a timestamp', async () => {
    const updatePayload: unknown[] = [];
    const eqMock = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn((payload: unknown) => {
          updatePayload.push(payload);
          return { eq: eqMock };
        }),
      })),
    };
    const { resolveQueueItem: resolve } = await loadUpgradeQueueModule(supabase);
    await expect(resolve('abc', 'completed')).resolves.toBeUndefined();
    expect(updatePayload).toHaveLength(1);
    expect(updatePayload[0]).toMatchObject({ status: 'completed', completed_at: expect.any(String) });
    expect(eqMock).toHaveBeenCalledWith('id', 'abc');
  });

  it('marks a queue item dismissed with completed_at null', async () => {
    const updatePayload: unknown[] = [];
    const eqMock = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn((payload: unknown) => {
          updatePayload.push(payload);
          return { eq: eqMock };
        }),
      })),
    };
    const { resolveQueueItem: resolve } = await loadUpgradeQueueModule(supabase);
    await expect(resolve('abc', 'dismissed')).resolves.toBeUndefined();
    expect(updatePayload).toHaveLength(1);
    expect(updatePayload[0]).toEqual({ status: 'dismissed', completed_at: null });
    expect(eqMock).toHaveBeenCalledWith('id', 'abc');
  });

  it('throws when resolving a queue item fails', async () => {
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: { message: 'nope' } })) })),
      })),
    };
    const { resolveQueueItem: resolve } = await loadUpgradeQueueModule(supabase);
    await expect(resolve('abc', 'completed')).rejects.toThrow('Failed to resolve queue item: nope');
  });

  it('lists the queue ordered by weakness and filtered by status', async () => {
    const rows = [
      { id: '1', weakness_score: 90, component_slug: 'a' },
      { id: '2', weakness_score: 40, component_slug: 'b' },
    ];
    const eqMock = vi.fn(async () => ({ data: rows, error: null }));
    const orderMock = vi.fn(() => ({
      eq: eqMock,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    }));
    const selectMock = vi.fn(() => ({ order: orderMock }));
    const supabase = { from: vi.fn(() => ({ select: selectMock })) };
    const { listUpgradeQueue: list } = await loadUpgradeQueueModule(supabase);

    const result = await list('queued');
    expect(selectMock).toHaveBeenCalledWith('*');
    expect(orderMock).toHaveBeenCalledWith('weakness_score', { ascending: false });
    expect(eqMock).toHaveBeenCalledWith('status', 'queued');
    expect(result).toEqual(rows);
  });

  it('does not filter by status when none is provided', async () => {
    const rows = [{ id: '1', weakness_score: 90, component_slug: 'a' }];
    const eqMock = vi.fn(async () => ({ data: rows, error: null }));
    const orderMock = vi.fn(() => ({
      eq: eqMock,
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    }));
    const supabase = { from: vi.fn(() => ({ select: vi.fn(() => ({ order: orderMock })) })) };
    const { listUpgradeQueue: list } = await loadUpgradeQueueModule(supabase);

    const result = await list();
    expect(result).toEqual(rows);
    expect(eqMock).not.toHaveBeenCalled();
  });

  it('throws when listing the queue fails', async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            then: (resolve: (value: unknown) => void) => resolve({ data: null, error: { message: 'x' } }),
          })),
        })),
      })),
    };
    const { listUpgradeQueue: list } = await loadUpgradeQueueModule(supabase);
    await expect(list()).rejects.toThrow('Failed to list upgrade queue: x');
  });
});
