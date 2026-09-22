import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishIssueNotification, publishResultNotification } from '../src/lib/draymond/ntfy';

const saved: Record<string, string | undefined> = {
  NTFY_URL: process.env.NTFY_URL,
  NTFY_TOPIC_RESULTS: process.env.NTFY_TOPIC_RESULTS,
  OPENHUB_NTFY_URL: process.env.OPENHUB_NTFY_URL,
  OPENHUB_NTFY_TOPIC: process.env.OPENHUB_NTFY_TOPIC,
  OPENHUB_NTFY_TOKEN: process.env.OPENHUB_NTFY_TOKEN,
  DRAYMOND_PUBLIC_URL: process.env.DRAYMOND_PUBLIC_URL,
};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

function mockFetch(calls: Array<{ url: string; init?: RequestInit }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200 } as unknown as Response;
  }));
}

describe('ntfy → OpenHub channel mirror', () => {
  it('result notifications publish to ntfy.sh AND mirror to the OpenHub channel with Bearer', async () => {
    process.env.NTFY_URL = 'https://ntfy.sh';
    process.env.NTFY_TOPIC_RESULTS = 'ov365-results';
    process.env.OPENHUB_NTFY_URL = 'https://openhub.overlay365.com/ntfy';
    process.env.OPENHUB_NTFY_TOPIC = 'openhub-reports';
    process.env.OPENHUB_NTFY_TOKEN = 'tok123';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch(calls);

    const ok = await publishResultNotification({ operation: 'deploy', success: true, status_code: 200 });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://ntfy.sh');
    expect(calls[1].url).toBe('https://openhub.overlay365.com/ntfy');
    const mirrorBody = JSON.parse(String(calls[1].init?.body));
    expect(mirrorBody.topic).toBe('openhub-reports');
    expect(mirrorBody.title).toContain('AetherDesk result');
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('issue alerts mirror to the OpenHub channel even when the ntfy.sh publish fails', async () => {
    process.env.NTFY_URL = 'https://ntfy.sh';
    process.env.NTFY_TOPIC_RESULTS = 'ov365-results';
    process.env.DRAYMOND_PUBLIC_URL = 'https://draymond.overlay365.com';
    process.env.OPENHUB_NTFY_URL = 'https://openhub.overlay365.com/ntfy';
    process.env.OPENHUB_NTFY_TOKEN = 'tok123';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.includes('ntfy.sh') ? ({ ok: false, status: 500, text: async () => '' } as unknown as Response) : ({ ok: true, status: 200 } as unknown as Response);
    }));

    const ok = await publishIssueNotification({ title: 'Job failed', message: 'circle-report down', repair: { kind: 'job', signal: 'job:error', detail: 'fetch failed' } });
    expect(ok).toBe(false); // ntfy.sh publish failed
    expect(calls).toHaveLength(2); // ntfy.sh + openhub mirror
    expect(calls[1].url).toBe('https://openhub.overlay365.com/ntfy');
    const mirrorBody = JSON.parse(String(calls[1].init?.body));
    expect(mirrorBody.topic).toBe('openhub-reports');
    expect(mirrorBody.title).toBe('Job failed');
  });

  it('does not mirror when the OpenHub channel is not configured', async () => {
    process.env.NTFY_URL = 'https://ntfy.sh';
    process.env.NTFY_TOPIC_RESULTS = 'ov365-results';
    delete process.env.OPENHUB_NTFY_URL;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mockFetch(calls);
    const ok = await publishResultNotification({ operation: 'deploy', success: false, error: 'boom' });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1); // only ntfy.sh
  });
});