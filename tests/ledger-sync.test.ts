import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postLedgerEvent, ledgerConfigured } from '../src/lib/draymond/ledger-sync';
import { createAffiliate, recordAttribution, setCommissionStatus } from '../src/lib/draymond/affiliates';

const BASE = 'http://localhost:4000';
const dirs: string[] = [];

beforeEach(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-ledger-'));
  dirs.push(tmp);
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FINANCE_CONNECT_URL;
  delete process.env.FINANCE_CONNECT_TOKEN;
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('ledger-sync', () => {
  it('is inert when finance-connect is not configured', async () => {
    expect(ledgerConfigured()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ok = await postLedgerEvent({ kind: 'commission.accrued', id: 'c1', amountCents: 100 });
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a normalized event to the ledger ingest endpoint', async () => {
    process.env.FINANCE_CONNECT_URL = BASE;
    process.env.FINANCE_CONNECT_TOKEN = 'secret';
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    const ok = await postLedgerEvent({
      kind: 'payout.paid',
      id: 'comm_9',
      amountCents: 5000,
      occurredAt: '2026-09-01T00:00:00.000Z',
      memo: 'commission paid',
    });
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/ledger/ingest`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toMatchObject({
      kind: 'payout.paid',
      id: 'comm_9',
      amount_cents: 5000,
      memo: 'commission paid',
    });
  });

  it('is fail-soft when the ledger is unreachable', async () => {
    process.env.FINANCE_CONNECT_URL = BASE;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }));
    await expect(postLedgerEvent({ kind: 'commission.accrued', id: 'c1', amountCents: 1 })).resolves.toBe(false);
  });
});

describe('affiliate hooks post to the spine', () => {
  it('posts a commission.accrued event when revenue is attributed', async () => {
    process.env.FINANCE_CONNECT_URL = BASE;
    process.env.FINANCE_CONNECT_TOKEN = 'secret';
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    await createAffiliate({ code: 'ref1', name: 'Ref', role: 'referrer' });
    await recordAttribution('revenue', { code: 'ref1', customerId: 'cus_1', amountUsd: 500 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/ledger/ingest`);
    expect(JSON.parse(init.body as string)).toMatchObject({ kind: 'commission.accrued', amount_cents: 10_000 });
  });

  it('posts payout.paid when a commission is marked paid', async () => {
    process.env.FINANCE_CONNECT_URL = BASE;
    process.env.FINANCE_CONNECT_TOKEN = 'secret';
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    await createAffiliate({ code: 'ref2', name: 'Ref', role: 'referrer' });
    const { commissions } = await recordAttribution('revenue', { code: 'ref2', customerId: 'cus_2', amountUsd: 100 });
    await setCommissionStatus(commissions[0]!.id, 'paid');

    const bodies = fetchSpy.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[0]).toMatchObject({ kind: 'commission.accrued' });
    expect(bodies[1]).toMatchObject({ kind: 'payout.paid', amount_cents: 2_000 });
  });
});
