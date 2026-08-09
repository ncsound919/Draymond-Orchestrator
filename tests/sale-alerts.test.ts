import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, writeState, emptyTreasuryState, type TreasuryState } from '../src/lib/draymond/treasury-state';
import { findNewSettledCharges, sendSaleAlerts } from '../src/lib/draymond/sale-alerts';

let tmp: string;
const originalEnv = { ...process.env };

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-sale-alerts-'));
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

afterAll(() => {
  process.env = { ...originalEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

function seededState(): TreasuryState {
  const s = emptyTreasuryState();
  s.charges = {
    c_new: { id: 'c_new', amountCents: 25000, currency: 'usd', platform: 'justice', status: 'succeeded', createdAt: new Date(Date.now() - 3600_000).toISOString() },
    c_old: { id: 'c_old', amountCents: 10000, currency: 'usd', platform: 'wealth', status: 'succeeded', createdAt: new Date(Date.now() - 7200_000).toISOString() },
    c_refunded: { id: 'c_refunded', amountCents: 5000, currency: 'usd', platform: 'health', status: 'refunded', createdAt: new Date(Date.now() - 1800_000).toISOString() },
  };
  s.revenueCents = 35000;
  return s;
}

describe('findNewSettledCharges', () => {
  it('returns only succeeded charges that have not alerted, sorted oldest-first', () => {
    const s = seededState();
    const fresh = findNewSettledCharges(s);
    expect(fresh).toHaveLength(2);
    expect(fresh[0]!.chargeId).toBe('c_old'); // older first
    expect(fresh[1]!.chargeId).toBe('c_new');
    // refunded is excluded
    expect(fresh.some((f) => f.chargeId === 'c_refunded')).toBe(false);
    // amount conversion
    expect(fresh[0]!.amountUsd).toBe(100);
    expect(fresh[1]!.amountUsd).toBe(250);
  });

  it('skips charges already marked alerted', () => {
    const s = seededState();
    s.alertedChargeIds = ['c_old'];
    const fresh = findNewSettledCharges(s);
    expect(fresh.map((f) => f.chargeId)).toEqual(['c_new']);
  });
});

describe('sendSaleAlerts', () => {
  beforeEach(async () => {
    const f = path.join(tmp, 'treasury.json');
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    delete process.env.NTFY_URL;
    delete process.env.NTFY_TOPIC_RESULTS;
    delete process.env.DRAYMOND_ALERT_EMAIL;
    delete process.env.GMAIL_USER;
  });

  it('returns empty when there are no new settled charges', async () => {
    await writeState(emptyTreasuryState());
    const sent = await sendSaleAlerts();
    expect(sent).toHaveLength(0);
  });

  it('marks new charges alerted after attempting (dedupe on second call)', async () => {
    await writeState(seededState());
    // No ntfy/email configured → publishing is skipped, but charges still marked.
    const first = await sendSaleAlerts();
    expect(first.length).toBeGreaterThanOrEqual(0);

    const state = await readState();
    const alerted = new Set(state.alertedChargeIds);
    expect(alerted.has('c_new')).toBe(true);
    expect(alerted.has('c_old')).toBe(true);
    expect(alerted.has('c_refunded')).toBe(false);

    // Second call: nothing new to alert.
    const second = await sendSaleAlerts();
    expect(second).toHaveLength(0);
  });
});
