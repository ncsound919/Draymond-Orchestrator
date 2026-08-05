import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// Mock the notifications module so the route never touches nodemailer/Supabase.
const mocks = vi.hoisted(() => ({
  sendMemo: vi.fn(),
}));

vi.mock('../src/lib/draymond/notifications', () => ({
  sendMemo: mocks.sendMemo,
  sendNotification: vi.fn(),
  sendAlertEmail: vi.fn(),
  sendHealthDigest: vi.fn(),
  getNotificationHistory: vi.fn(),
}));

/** Build a NextRequest-like request object for the route handler. */
function makeRequest(url: string, init: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

describe('POST /api/notifications/memo', () => {
  const sendMemo = mocks.sendMemo;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.GMAIL_USER = 'tap4500@gmail.com';
    process.env.DRAYMOND_ALERT_EMAIL = 'tap4500@gmail.com';
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.GMAIL_USER;
    delete process.env.DRAYMOND_ALERT_EMAIL;
    sendMemo.mockReset();
  });

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('../src/app/api/notifications/memo/route');
    const req = makeRequest('http://localhost/api/notifications/memo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'Hi', body: 'Memo' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(sendMemo).not.toHaveBeenCalled();
  });

  it('returns 400 when subject is missing', async () => {
    const { POST } = await import('../src/app/api/notifications/memo/route');
    const req = makeRequest('http://localhost/api/notifications/memo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: 'Memo' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sendMemo).not.toHaveBeenCalled();
  });

  it('returns 400 when body is missing', async () => {
    const { POST } = await import('../src/app/api/notifications/memo/route');
    const req = makeRequest('http://localhost/api/notifications/memo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subject: 'Hi' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(sendMemo).not.toHaveBeenCalled();
  });

  it('sends a memo and returns the notification record', async () => {
    const record = {
      id: 'memo-1',
      channel: 'email',
      recipient: 'tap4500@gmail.com',
      subject: 'Weekly Update',
      body: 'All systems operational.',
      type: 'memo',
      priority: 'low',
      status: 'sent',
      related_agent_id: null,
      related_event_id: null,
      related_chain_id: null,
      metadata: {},
      sent_at: '2026-08-05T00:00:00Z',
      error_message: null,
      created_at: '2026-08-05T00:00:00Z',
    };
    sendMemo.mockResolvedValue(record as never);

    const { POST } = await import('../src/app/api/notifications/memo/route');
    const req = makeRequest('http://localhost/api/notifications/memo', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-cron-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subject: 'Weekly Update',
        body: 'All systems operational.',
        recipient: 'tap4500@gmail.com',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; notification: typeof record };
    expect(json.ok).toBe(true);
    expect(json.notification.id).toBe('memo-1');
    expect(sendMemo).toHaveBeenCalledWith(
      'Weekly Update',
      'All systems operational.',
      'tap4500@gmail.com',
    );
  });
});
