import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('POST /api/v1/voice/transcribe', () => {
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
    const { POST } = await import('../src/app/api/v1/voice/transcribe/route');
    const req = new Request('http://localhost/api/v1/voice/transcribe', {
      method: 'POST',
      body: new Uint8Array([1, 2, 3, 4]),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies PCM bytes to AetherDesk and returns the transcript', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }),
    );
    const { POST } = await import('../src/app/api/v1/voice/transcribe/route');
    const pcm = new Uint8Array([0, 0, 0, 0, 1, 0, 1, 0]);
    const req = new Request('http://localhost/api/v1/voice/transcribe', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-cron-secret' },
      body: pcm,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'hello world' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8000/api/v1/voice/transcribe');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('aetherdesk-key');
    expect(init.method).toBe('POST');
  });

  it('returns 502 when AetherDesk is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const { POST } = await import('../src/app/api/v1/voice/transcribe/route');
    const req = new Request('http://localhost/api/v1/voice/transcribe', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-cron-secret' },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
