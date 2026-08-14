import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.stubGlobal('fetch', fetchMock);

type HooksMod = typeof import('../src/lib/draymond/hooks');
let mod: HooksMod;

beforeEach(async () => {
  vi.resetModules(); // clears the module-level _hooks registry
  fetchMock.mockReset();
  mod = await import('../src/lib/draymond/hooks');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function hookInput(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'chain.completed',
    callback_url: 'https://hooks.example.com/draymond',
    is_active: true,
    max_failures: 3,
    ...overrides,
  } as Parameters<typeof mod.registerHook>[0];
}

describe('registerHook', () => {
  it('registers a hook and returns a populated subscription', () => {
    const sub = mod.registerHook(hookInput({ secret: 's3cret' }));
    expect(sub.id).toBeTruthy();
    expect(sub.failure_count).toBe(0);
    expect(sub.created_at).toBeTruthy();
    expect(mod.getHook(sub.id)?.callback_url).toBe('https://hooks.example.com/draymond');
  });

  it('rejects non-http callback URLs', () => {
    expect(() => mod.registerHook(hookInput({ callback_url: 'file:///etc/passwd' }))).toThrow(/scheme/);
    expect(() => mod.registerHook(hookInput({ callback_url: 'javascript:alert(1)' }))).toThrow(/scheme/);
  });

  it('blocks private IP callbacks in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => mod.registerHook(hookInput({ callback_url: 'http://192.168.1.1/hook' }))).toThrow(/private/);
    expect(() => mod.registerHook(hookInput({ callback_url: 'http://localhost/hook' }))).toThrow(/private/);
  });

  it('allows an allowlisted localhost callback in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', 'localhost,127.0.0.1');
    expect(() => mod.registerHook(hookInput({ callback_url: 'http://localhost:8777/hook' }))).not.toThrow();
  });

  it('blocks a non-allowlisted localhost callback in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', 'services.internal');
    expect(() => mod.registerHook(hookInput({ callback_url: 'http://localhost:8777/hook' }))).toThrow(/private/);
  });

  it('rejects invalid max_failures and secret', () => {
    expect(() => mod.registerHook(hookInput({ max_failures: 0 }))).toThrow(/max_failures/);
    expect(() => mod.registerHook(hookInput({ max_failures: Number.NaN }))).toThrow(/max_failures/);
    expect(() => mod.registerHook(hookInput({ secret: '' }))).toThrow(/secret/);
  });

  it('throws when the registry is full', () => {
    for (let i = 0; i < 500; i++) {
      mod.registerHook(hookInput({ callback_url: `https://hooks.example.com/${i}` }));
    }
    expect(() => mod.registerHook(hookInput({ callback_url: 'https://hooks.example.com/500' }))).toThrow(/limit/);
  });
});

describe('unregisterHook / listHooks / getHook', () => {
  it('unregisters a hook by id', () => {
    const sub = mod.registerHook(hookInput());
    expect(mod.unregisterHook(sub.id)).toBe(true);
    expect(mod.unregisterHook(sub.id)).toBe(false);
    expect(mod.getHook(sub.id)).toBeUndefined();
  });

  it('lists hooks filtered by event type', () => {
    mod.registerHook(hookInput({ event_type: 'chain.completed' }));
    mod.registerHook(hookInput({ event_type: 'chain.failed' }));
    const completed = mod.listHooks('chain.completed');
    expect(completed).toHaveLength(1);
    expect(mod.listHooks()).toHaveLength(2);
  });
});

describe('dispatchEvent', () => {
  it('returns zero counts when no subscriptions match', async () => {
    mod.registerHook(hookInput({ event_type: 'chain.failed' }));
    const result = await mod.dispatchEvent('chain.completed', { chain_id: 'x' });
    expect(result).toEqual({ dispatched: 0, failed: 0 });
  });

  it('delivers to matching hooks and sends an HMAC signature when a secret is set', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    mod.registerHook(hookInput({ secret: 'sec' }));
    const result = await mod.dispatchEvent('chain.completed', { chain_id: 'abc' });
    expect(result.dispatched).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://hooks.example.com/draymond');
    expect((init.headers as Record<string, string>)['X-Draymond-Signature']).toBeTruthy();
    expect(JSON.parse(init.body as string).data.chain_id).toBe('abc');
  });

  it('applies agent and entity filters', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    mod.registerHook(hookInput({ agent_filter: 'agent-1', entity_filter: 'ent-1' }));
    const noMatch = await mod.dispatchEvent('chain.completed', {}, 'agent-2');
    expect(noMatch.dispatched).toBe(0);
    const match = await mod.dispatchEvent('chain.completed', {}, 'agent-1', 'ent-1');
    expect(match.dispatched).toBe(1);
  });

  it('increments failures and disables the hook after max_failures', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sub = mod.registerHook(hookInput({ max_failures: 2 }));
    await mod.dispatchEvent('chain.completed', {});
    await mod.dispatchEvent('chain.completed', {});
    expect(mod.getHook(sub.id)?.is_active).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('counts fetch rejections as failures', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    mod.registerHook(hookInput({ max_failures: 1 }));
    const result = await mod.dispatchEvent('chain.completed', {});
    expect(result.failed).toBe(1);
  });
});

describe('notifyHooks', () => {
  it('is fire-and-forget and swallows errors', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    mod.registerHook(hookInput());
    expect(() => mod.notifyHooks('chain.completed', {})).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalled();
  });
});
