import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { isLangfuseConfigured, ingestTrace } from '../src/lib/draymond/trace';

afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('langfuse trace helper', () => {
  it('is not configured without a URL + secret', () => {
    vi.stubEnv('LANGFUSE_URL', '');
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    expect(isLangfuseConfigured()).toBe(false);
  });

  it('is configured with a URL + secret', () => {
    vi.stubEnv('LANGFUSE_URL', 'http://localhost:3000');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-test');
    expect(isLangfuseConfigured()).toBe(true);
  });

  it('is a strict no-op when unconfigured (no fetch)', async () => {
    vi.stubEnv('LANGFUSE_URL', '');
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    await ingestTrace({ id: 't1', name: 'chat_turn', timestamp: new Date().toISOString() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs an OpenAI-ingestable trace with basic auth when configured', async () => {
    vi.stubEnv('LANGFUSE_URL', 'http://localhost:3000');
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-test');
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await ingestTrace({
      id: 't1',
      name: 'chat_turn',
      timestamp: '2026-08-07T00:00:00Z',
      input: 'hi',
      metadata: { intent: 'query_status' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3000/api/public/trace');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
    );
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('chat_turn');
    expect(body.metadata.intent).toBe('query_status');
  });

  it('never throws when the Langfuse endpoint is down', async () => {
    vi.stubEnv('LANGFUSE_URL', 'http://localhost:3000');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-test');
    fetchMock.mockRejectedValue(new Error('connection refused'));

    await expect(
      ingestTrace({ id: 't1', name: 'chat_turn', timestamp: new Date().toISOString() }),
    ).resolves.toBeUndefined();
  });
});
