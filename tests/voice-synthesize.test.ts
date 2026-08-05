import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('POST /api/v1/voice/synthesize', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.AETHERDESK_BASE_URL = 'http://127.0.0.1:8000/api/v1';
    process.env.AETHERDESK_API_KEY = 'aetherdesk-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRON_SECRET;
    delete process.env.AETHERDESK_BASE_URL;
    delete process.env.AETHERDESK_API_KEY;
    fetchMock.mockReset();
  });

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('../src/app/api/v1/voice/synthesize/route');
    const req = new Request('http://localhost/api/v1/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies text to AetherDesk and returns base64 audio', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ audio: 'QUJDRA==' }), { status: 200 }),
    );
    const { POST } = await import('../src/app/api/v1/voice/synthesize/route');
    const req = new Request('http://localhost/api/v1/voice/synthesize', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'hello world' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ audio: 'QUJDRA==' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8000/api/v1/voice/synthesize');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('aetherdesk-key');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello world' });
  });

  it('returns 400 when text is empty', async () => {
    const { POST } = await import('../src/app/api/v1/voice/synthesize/route');
    const req = new Request('http://localhost/api/v1/voice/synthesize', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: '   ' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
