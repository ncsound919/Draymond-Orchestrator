import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { reportToOpenHub, reportToOpenHubBestEffort } from '../src/lib/draymond/openhub-report';

describe('openhub-report', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('OPENHUB_URL', 'http://127.0.0.1:3010');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('posts a report to OpenHub ecosystem repair intake', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          dispatch: 'axiom-dispatched',
          loopId: 'loop-1',
          incident: { id: 'inc-1' },
          audit: { overallStatus: 'fail', grade: 'F' },
        }),
        { status: 200 },
      )
    );

    const result = await reportToOpenHub({
      toolId: 'recourse',
      source: 'draymond',
      severity: 'high',
      kind: 'repair:code_error',
      detail: 'something broke',
    });

    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe('axiom-dispatched');
    expect(result.loopId).toBe('loop-1');
    expect(result.incidentId).toBe('inc-1');
    expect(result.auditStatus).toBe('fail');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3010/api/ecosystem/report');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.toolId).toBe('recourse');
    expect(body.source).toBe('draymond');
    expect(body.preset).toBe('quick');
  });

  it('returns an honest error on OpenHub HTTP failure', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'no folder' }), { status: 400 }));
    const result = await reportToOpenHub({ toolId: 'x', source: 'draymond', severity: 'low', kind: 'k', detail: 'd' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no folder');
  });

  it('returns an honest error when OpenHub is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await reportToOpenHub({ toolId: 'x', source: 'draymond', severity: 'low', kind: 'k', detail: 'd' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unreachable');
  });

  it('best-effort swallows failures so callers are never gated', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await reportToOpenHubBestEffort({ toolId: 'x', source: 'dev-brain', severity: 'low', kind: 'k', detail: 'd' });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
  });
});