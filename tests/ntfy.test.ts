import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildApprovalPayload,
  publishApprovalNotification,
  publishResultNotification,
  publishIssueNotification,
  issueRepairToken,
  consumeRepairToken,
} from '../src/lib/draymond/ntfy';

const action = {
  id: 'act-1',
  description: 'Approve the campaign',
  risk_level: 'high',
  confidence_score: 0.8,
  review_token: 'tok-123',
} as unknown as Parameters<typeof buildApprovalPayload>[0];

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setNtfyEnv() {
  process.env.NTFY_URL = 'https://ntfy.example.com/';
  process.env.NTFY_TOPIC = 'approvals';
  process.env.NTFY_TOPIC_RESULTS = 'results';
  process.env.DRAYMOND_PUBLIC_URL = 'https://draymond.example.com';
}

describe('buildApprovalPayload', () => {
  it('returns null when ntfy is not configured', () => {
    delete process.env.NTFY_URL;
    expect(buildApprovalPayload(action)).toBeNull();
  });

  it('builds a full payload with approve/reject actions', () => {
    setNtfyEnv();
    const payload = buildApprovalPayload(action) as {
      topic: string;
      priority: number;
      actions: Array<{ label: string; url: string; headers: Record<string, string> }>;
    } | null;
    expect(payload).not.toBeNull();
    expect(payload!.topic).toBe('approvals');
    expect(payload!.actions).toHaveLength(2);
    expect(payload!.actions[0].label).toBe('Approve');
    expect(payload!.actions[0].url).toContain('/api/v1/actions/act-1/review');
    expect(payload!.actions[0].headers['X-Review-Token']).toBe('tok-123');
    expect(payload!.actions[1].label).toBe('Reject');
  });

  it('maps critical risk to the highest priority', () => {
    setNtfyEnv();
    const p = buildApprovalPayload({ ...action, risk_level: 'critical' }) as { priority: number } | null;
    expect(p!.priority).toBe(5);
  });
});

describe('publishApprovalNotification', () => {
  it('returns false when unconfigured', async () => {
    delete process.env.NTFY_URL;
    expect(await publishApprovalNotification(action)).toBe(false);
  });

  it('returns true on a 2xx response', async () => {
    setNtfyEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await publishApprovalNotification(action)).toBe(true);
  });

  it('returns false on a non-2xx response', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await publishApprovalNotification(action)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('returns false when fetch rejects', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await publishApprovalNotification(action)).toBe(false);
  });
});

describe('publishResultNotification', () => {
  it('returns false when results topic is unconfigured', async () => {
    setNtfyEnv();
    delete process.env.NTFY_TOPIC_RESULTS;
    expect(await publishResultNotification({ operation: 'x', success: true })).toBe(false);
  });

  it('publishes a success result', async () => {
    setNtfyEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await publishResultNotification({ operation: 'launch', success: true, status_code: 200 })).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.topic).toBe('results');
    expect(body.title).toContain('result');
  });

  it('publishes a failure result', async () => {
    setNtfyEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await publishResultNotification({ operation: 'launch', success: false, error: 'boom' })).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.title).toContain('failed');
    expect(body.message).toContain('boom');
  });

  it('returns false on a non-2xx response', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    expect(await publishResultNotification({ operation: 'health', success: true })).toBe(false);
  });

  it('returns false when publish rejects', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await publishResultNotification({ operation: 'health', success: true })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });
});

describe('publishIssueNotification', () => {
  it('returns false when results topic is unconfigured', async () => {
    setNtfyEnv();
    delete process.env.NTFY_TOPIC_RESULTS;
    expect(await publishIssueNotification({ title: 'x', message: 'y' })).toBe(false);
  });

  it('publishes an issue alert to the results topic', async () => {
    setNtfyEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await publishIssueNotification({
      title: 'Draymond · daily-report FAILED',
      message: 'boom',
      priority: 5,
      tags: ['rotating_light', 'warning'],
    });
    expect(ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.topic).toBe('results');
    expect(body.title).toContain('daily-report FAILED');
    expect(body.priority).toBe(5);
    expect(body.tags).toEqual(['rotating_light', 'warning']);
    expect(body.actions).toBeUndefined();
  });

  it('adds a Diagnose & Repair action with a single-use token when the tunnel is set', async () => {
    setNtfyEnv();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await publishIssueNotification({
      title: 'Draymond · alert',
      message: 'detail',
      repair: { kind: 'job', signal: 'job:error', detail: 'boom', job: { id: 'j1', name: 'x', job_type: 'custom', job_config: {} } },
    });
    expect(ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const action = body.actions[0];
    expect(action.label).toBe('Diagnose & Repair');
    expect(action.method).toBe('POST');
    expect(action.url).toBe('https://draymond.example.com/api/ops/repair-triage');
    expect(action.headers['Content-Type']).toBe('application/json');
    expect(typeof action.headers['X-Repair-Token']).toBe('string');
    expect(JSON.parse(action.body)).toEqual({ signal: 'job:error', detail: 'boom' });
    // Simulate the Open-Chat button tap → the endpoint consumes the token once.
    const claim = consumeRepairToken(action.headers['X-Repair-Token']);
    expect(claim).toEqual({ kind: 'job', signal: 'job:error', detail: 'boom', job: { id: 'j1', name: 'x', job_type: 'custom', job_config: {} } });
    expect(consumeRepairToken(action.headers['X-Repair-Token'])).toBeNull(); // single-use
  });

  it('omits the action when no public tunnel URL is configured', async () => {
    setNtfyEnv();
    delete process.env.DRAYMOND_PUBLIC_URL;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await publishIssueNotification({
      title: 'x',
      message: 'y',
      repair: { kind: 'monitor', signal: 'monitor:down', detail: 'down' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.actions).toBeUndefined();
  });

  it('returns false on a non-2xx response', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    expect(await publishIssueNotification({ title: 'x', message: 'y' })).toBe(false);
  });

  it('returns false when publish rejects', async () => {
    setNtfyEnv();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await publishIssueNotification({ title: 'x', message: 'y' })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });
});

describe('repair tokens', () => {
  it('mints and consumes a single-use repair token', () => {
    const { token } = issueRepairToken({ kind: 'monitor', signal: 'monitor:down', detail: 'down' });
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(64);
    const claim = consumeRepairToken(token);
    expect(claim).not.toBeNull();
    expect(claim!.signal).toBe('monitor:down');
    expect(consumeRepairToken(token)).toBeNull(); // already consumed
  });

  it('returns null for unknown or empty tokens', () => {
    expect(consumeRepairToken('nope')).toBeNull();
    expect(consumeRepairToken('')).toBeNull();
  });
});
