import { describe, expect, it, vi } from 'vitest';

describe('runBenchmarkCycle', () => {
  it('returns a summary without throwing when sources are empty', async () => {
    // Fluent thenable builder matching the proven upgrade-queue mock pattern:
    // `select(...)` / `gte(...)` chain to a builder that resolves to an empty
    // result set, which is what runBenchmarkCycle hits for an empty run.
    const supabase = {
      from: vi.fn(() => {
        const builder = {
          select: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
        };
        return builder;
      }),
    };
    vi.doMock('../src/lib/draymond/client', () => ({ createDraymondAdminClient: () => supabase }));
    vi.resetModules();
    const { runBenchmarkCycle: cycle } = await import('../src/lib/draymond/run-benchmark');
    const result = await cycle('entity');
    expect(result.componentClass).toBe('entity');
    expect(typeof result.recorded).toBe('number');
    expect(Array.isArray(result.weakest)).toBe(true);
  });
});
