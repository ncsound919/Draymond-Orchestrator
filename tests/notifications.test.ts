import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockSendMail } = vi.hoisted(() => {
  const makeChain = (tables: Map<string, unknown>, table: string) => {
    const op = { current: 'select' as string };
    const resolve = () => {
      const entry = tables.get(table);
      if (typeof entry === 'function') return (entry as (o: string) => unknown)(op.current);
      return entry ?? { data: null, error: null };
    };
    const chain = {
      select: vi.fn(() => {
        if (op.current !== 'insert' && op.current !== 'update') op.current = 'select';
        return chain;
      }),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      insert: vi.fn(() => { op.current = 'insert'; return chain; }),
      update: vi.fn(() => { op.current = 'update'; return chain; }),
      single: vi.fn(() => Promise.resolve(resolve())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  };
  const tables = new Map<string, unknown>();
  const client = { from: vi.fn((t: string) => makeChain(tables, t)), _tables: tables };
  return { mockClient: client, mockSendMail: vi.fn() };
});

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
}));
vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => mockClient),
}));
vi.mock('../src/lib/draymond/event-bridge', () => ({
  emitNotificationSent: vi.fn(),
  emitNotificationFailed: vi.fn(),
}));

const record = { id: 'n1', channel: 'email', recipient: 'a@b.c', subject: 'S', body: 'B', type: 'memo', priority: 'low', status: 'pending', related_agent_id: null, related_event_id: null, related_chain_id: null, metadata: {}, sent_at: null, error_message: null, created_at: '2026-01-01' };

const originalEnv = { ...process.env };

type NotifMod = typeof import('../src/lib/draymond/notifications');
let mod: NotifMod;

beforeEach(async () => {
  vi.resetModules(); // clears the module-level transporter singleton
  mockClient._tables.clear();
  mod = await import('../src/lib/draymond/notifications');
});

afterEach(() => {
  for (const key of ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'DRAYMOND_ALERT_EMAIL']) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  mockClient._tables.clear();
  mockSendMail.mockReset();
});

describe('sendNotification', () => {
  it('rejects invalid recipient emails', async () => {
    await expect(mod.sendNotification({ channel: 'email', recipient: 'not-an-email', subject: 's', body: 'b', type: 'memo' }))
      .rejects.toThrow(/Invalid recipient/);
  });

  it('blocks header-injection in recipient', async () => {
    await expect(mod.sendNotification({ channel: 'email', recipient: 'a@b.c\nBcc: x@y.z', subject: 's', body: 'b', type: 'memo' }))
      .rejects.toThrow(/Invalid recipient/);
  });

  it('throws when the insert fails', async () => {
    mockClient._tables.set('draymond_notifications', { data: null, error: { message: 'insert failed' } });
    await expect(mod.sendNotification({ channel: 'email', recipient: 'a@b.c', subject: 's', body: 'b', type: 'memo' }))
      .rejects.toThrow(/insert failed/);
  });

  it('records the notification as failed when GMAIL env vars are missing', async () => {
    process.env.GMAIL_USER = '';
    process.env.GMAIL_APP_PASSWORD = '';
    mockClient._tables.set('draymond_notifications', (op: string) =>
      op === 'update' ? { data: { ...record, status: 'failed', error_message: 'Missing env var: GMAIL_USER' }, error: null } : { data: record, error: null },
    );
    const result = await mod.sendNotification({ channel: 'email', recipient: 'a@b.c', subject: 's', body: 'b', type: 'memo' });
    expect(result.status).toBe('failed');
  });

  it('inserts, sends via SMTP, and marks the notification sent', async () => {
    process.env.GMAIL_USER = 'me@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'app-pass';
    mockSendMail.mockResolvedValue({ messageId: 'msg-1' });
    mockClient._tables.set('draymond_notifications', (op: string) =>
      op === 'update' ? { data: { ...record, status: 'sent' }, error: null } : { data: record, error: null },
    );

    const result = await mod.sendNotification({ channel: 'email', recipient: 'a@b.c', subject: 'Hello', body: 'Body', type: 'memo' });
    expect(result.id).toBe('n1');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailArgs = mockSendMail.mock.calls[0][0];
    expect(mailArgs.to).toBe('a@b.c');
    expect(mailArgs.html).toContain('Hello');
  });
});

describe('sendMemo', () => {
  it('throws without a recipient or configured email', async () => {
    delete process.env.DRAYMOND_ALERT_EMAIL;
    delete process.env.GMAIL_USER;
    await expect(mod.sendMemo('subject', 'body')).rejects.toThrow(/requires a recipient/);
  });

  it('delegates to sendNotification with memo type', async () => {
    process.env.DRAYMOND_ALERT_EMAIL = 'ops@example.com';
    process.env.GMAIL_USER = 'me@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'app-pass';
    mockSendMail.mockResolvedValue({});
    mockClient._tables.set('draymond_notifications', (op: string) =>
      op === 'update' ? { data: { ...record, status: 'sent' }, error: null } : { data: record, error: null },
    );
    const result = await mod.sendMemo('Memo subject', 'Memo body', 'recipient@example.com');
    expect(result.id).toBe('n1');
  });
});

describe('getNotificationHistory', () => {
  it('returns filtered notification history', async () => {
    mockClient._tables.set('draymond_notifications', { data: [record, record], error: null });
    const history = await mod.getNotificationHistory({ priority: 'normal', limit: 10 });
    expect(history).toHaveLength(2);
  });

  it('throws on query error', async () => {
    mockClient._tables.set('draymond_notifications', { data: null, error: { message: 'query failed' } });
    await expect(mod.getNotificationHistory()).rejects.toThrow(/query failed/);
  });
});

describe('sendAlertEmail', () => {
  it('sends an alert email via sendNotification', async () => {
    process.env.GMAIL_USER = 'me@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'app-pass';
    mockSendMail.mockResolvedValue({});
    mockClient._tables.set('draymond_notifications', (op: string) =>
      op === 'update' ? { data: { ...record, status: 'sent' }, error: null } : { data: record, error: null },
    );
    const result = await mod.sendAlertEmail('ops@example.com', 'Alert', 'Something happened');
    expect(result.id).toBe('n1');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });
});
