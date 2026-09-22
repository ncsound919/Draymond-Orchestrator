import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishToOpenHubChannel } from '../src/lib/draymond/communicator';

const saved: Record<string, string | undefined> = {
  OPENHUB_NTFY_URL: process.env.OPENHUB_NTFY_URL,
  OPENHUB_NTFY_TOPIC: process.env.OPENHUB_NTFY_TOPIC,
  OPENHUB_NTFY_TOKEN: process.env.OPENHUB_NTFY_TOKEN,
};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe('publishToOpenHubChannel', () => {
  it('reports not-configured when no URL is set', async () => {
    delete process.env.OPENHUB_NTFY_URL;
    const r = await publishToOpenHubChannel({ title: 't', message: 'm' });
    expect(r.published).toBe(false);
    expect(r.detail).toMatch(/not configured/);
  });

  it('posts to the OpenHub channel with the Bearer token', async () => {
    process.env.OPENHUB_NTFY_URL = 'https://openhub.overlay365.com/ntfy';
    process.env.OPENHUB_NTFY_TOPIC = 'openhub-reports';
    process.env.OPENHUB_NTFY_TOKEN = 'tok123';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200 } as unknown as Response;
    }));
    const r = await publishToOpenHubChannel({ title: 'Draymond midday recap', message: 'summary', tags: ['recap'], priority: 3 });
    expect(r.published).toBe(true);
    expect(calls[0].url).toBe('https://openhub.overlay365.com/ntfy');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.topic).toBe('openhub-reports');
    expect(body.title).toBe('Draymond midday recap');
    expect(body.priority).toBe(3);
  });

  it('reports failure honestly when the channel rejects (401)', async () => {
    process.env.OPENHUB_NTFY_URL = 'https://openhub.overlay365.com/ntfy';
    process.env.OPENHUB_NTFY_TOKEN = 'wrong';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }) as unknown as Response));
    const r = await publishToOpenHubChannel({ title: 't', message: 'm' });
    expect(r.published).toBe(false);
    expect(r.detail).toMatch(/401/);
  });
});