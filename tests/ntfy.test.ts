import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishResultNotification } from '../src/lib/draymond/ntfy';

describe('publishResultNotification', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.NTFY_URL = 'https://ntfy.sh';
    process.env.NTFY_TOPIC_RESULTS = 'draymond-results';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NTFY_URL;
    delete process.env.NTFY_TOPIC_RESULTS;
    fetchMock.mockReset();
  });

  it('publishes success message to the results topic', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const ok = await publishResultNotification({ operation: 'launch_campaign', success: true, status_code: 202 });
    expect(ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://ntfy.sh');
    const payload = JSON.parse(init.body as string);
    expect(payload.topic).toBe('draymond-results');
    expect(payload.title).toContain('AetherDesk');
    expect(payload.message).toContain('launch_campaign');
  });

  it('publishes failure message with the error text', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await publishResultNotification({ operation: 'launch_campaign', success: false, error: 'HTTP 500: boom' });

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body as string);
    expect(payload.message).toContain('boom');
    expect(payload.priority).toBe(5); // higher priority for failures
  });

  it('returns false without publishing when not configured', async () => {
    delete process.env.NTFY_URL;
    delete process.env.NTFY_TOPIC_RESULTS;
    const ok = await publishResultNotification({ operation: 'health', success: true });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false on non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const ok = await publishResultNotification({ operation: 'health', success: true });
    expect(ok).toBe(false);
  });
});
