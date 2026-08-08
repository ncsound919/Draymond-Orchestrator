import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', fetchMock);

import { getBrainStatus, runBrainSweep, isBrainConfigured } from '../src/lib/draymond/brain-client';

afterEach(() => {
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe('deterministic brain client', () => {
  it('is a no-op when BRAIN_URL is unset (returns null, no fetch)', async () => {
    vi.stubEnv('BRAIN_URL', '');
    expect(isBrainConfigured()).toBe(false);
    await expect(getBrainStatus()).resolves.toBeNull();
    await expect(runBrainSweep()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs /brain/status when configured', async () => {
    vi.stubEnv('BRAIN_URL', 'http://localhost:3210');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ last_run_at: 'x', open_findings: 3, total_findings: 5 }), { status: 200 }),
    );
    const status = await getBrainStatus();
    expect(status?.open_findings).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3210/brain/status');
    expect(init.method).toBeUndefined();
  });

  it('POSTs /brain/sweep with the sweep request body', async () => {
    vi.stubEnv('BRAIN_URL', 'http://localhost:3210');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ run_id: 'brain-abc', findings: [], summary: { recognized: 0 } }), { status: 200 }),
    );
    const report = await runBrainSweep({ mode: 'manual', scope: 'community', community: 'agents' });
    expect(report?.run_id).toBe('brain-abc');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3210/brain/sweep');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.mode).toBe('manual');
    expect(body.scope).toBe('community');
    expect(body.community).toBe('agents');
  });

  it('returns null when the brain server is unreachable (never throws)', async () => {
    vi.stubEnv('BRAIN_URL', 'http://localhost:3210');
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await expect(getBrainStatus()).resolves.toBeNull();
    await expect(runBrainSweep()).resolves.toBeNull();
  });
});
