import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runFreeCatalogSync } from '../src/lib/draymond/freeCatalogSync';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const POOL_KEYS = {
  OPENCODE_API_KEY: 'pool-key-primary-0123456789',
  OPENCODE_KEY_TAP4500: 'pool-key-tap4500-0123456789',
};
const SAVED: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [...Object.keys(POOL_KEYS), 'OPENROUTER_API_KEY', 'FREE_CATALOG_SYNC']) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, POOL_KEYS);
  fetchMock.mockReset();
});

afterEach(() => {
  for (const k of Object.keys(SAVED)) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  vi.useRealTimers();
});

const modelsRes = (ids: string[]) =>
  new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
const unauthorized = () => new Response('{"error":"Unauthorized"}', { status: 401 });
const completionRes = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('runFreeCatalogSync (dryRun)', () => {
  it('walks the key pool when the first key is dead', async () => {
    // Catalog fetch: primary key 401s, pool key returns candidates.
    fetchMock
      .mockResolvedValueOnce(unauthorized()) // catalog via OPENCODE_API_KEY
      .mockResolvedValueOnce(modelsRes(['live-model-free', 'other-free'])); // catalog via TAP4500
    // Probes for live-model-free: primary 401s, pool key eligible.
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(completionRes('pong'));
    // Probe for other-free: eligible on first key tried.
    fetchMock.mockResolvedValueOnce(completionRes('pong'));

    const r = await runFreeCatalogSync({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.eligible).toBeGreaterThanOrEqual(1);
    expect(r.assignedModel).toBe('live-model-free');
  });

  it('falls back without throwing when every key is dead', async () => {
    fetchMock.mockResolvedValue(unauthorized());
    const r = await runFreeCatalogSync({ dryRun: true });
    expect(r.eligible).toBe(0);
    expect(typeof r.assignedModel).toBe('string');
  });
});
