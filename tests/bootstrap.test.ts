import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.DRAYMOND_BOOT_GRAPH = '';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

async function loadBootstrap() {
  return await import('../src/lib/draymond/bootstrap');
}

describe('boot graph ordering', () => {
  it('preserves declaration order when no edges exist (default graph)', async () => {
    const mod = await loadBootstrap();
    const ordered = mod.orderBootServices([...mod.DEFAULT_CORE_SERVICES], mod.BOOT_GRAPH);

    expect(ordered).toEqual([...mod.DEFAULT_CORE_SERVICES]);
    expect(ordered[0]).toBe('deterministic-brain');
  });

  it('puts dependencies before dependents', async () => {
    const mod = await loadBootstrap();
    const graph = {
      a: { dependsOn: [] },
      b: { dependsOn: ['a'] },
      c: { dependsOn: ['b'] },
    };
    const ordered = mod.orderBootServices(['c', 'a', 'b'], graph);

    // a before b before c regardless of input order.
    expect(ordered.indexOf('a')).toBeLessThan(ordered.indexOf('b'));
    expect(ordered.indexOf('b')).toBeLessThan(ordered.indexOf('c'));
  });

  it('is stable for independent services (keeps declaration order)', async () => {
    const mod = await loadBootstrap();
    const graph = {
      x: { dependsOn: [] },
      y: { dependsOn: [] },
      z: { dependsOn: [] },
    };
    expect(mod.orderBootServices(['z', 'x', 'y'], graph)).toEqual(['z', 'x', 'y']);
  });

  it('ignores unknown dependency edges and still boots all slugs', async () => {
    const mod = await loadBootstrap();
    const graph = {
      a: { dependsOn: ['ghost'] },
      b: { dependsOn: [] },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ordered = mod.orderBootServices(['a', 'b'], graph);

    expect(ordered).toContain('a');
    expect(ordered).toContain('b');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    warn.mockRestore();
  });

  it('merges operator edges from DRAYMOND_BOOT_GRAPH', async () => {
    process.env.DRAYMOND_BOOT_GRAPH = JSON.stringify({
      sports: { dependsOn: ['odds'] },
      odds: { dependsOn: [] },
    });

    const mod = await loadBootstrap();
    const ordered = mod.orderBootServices(['sports', 'odds']);

    expect(ordered.indexOf('odds')).toBeLessThan(ordered.indexOf('sports'));
  });

  it('handles cycles without dead-locking (falls back to declaration order)', async () => {
    const mod = await loadBootstrap();
    const graph = {
      a: { dependsOn: ['b'] },
      b: { dependsOn: ['a'] },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ordered = mod.orderBootServices(['a', 'b'], graph);
    expect(ordered).toHaveLength(2);
    expect(new Set(ordered)).toEqual(new Set(['a', 'b']));
    // The cycle warning must actually fire (a→b→a back-edge).
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cycle detected at "a"'));
    warn.mockRestore();
  });
});
