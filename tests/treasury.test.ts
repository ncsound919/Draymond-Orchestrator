import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, writeState, recomputeRevenueFromLedger, settledRevenueUsd, emptyTreasuryState } from '../src/lib/draymond/treasury-state';
import { runTreasuryPulse, fetchStripeCharges } from '../src/lib/draymond/treasury';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-treasury-'));
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

beforeEach(() => {
  const stateFile = path.join(tmp, 'treasury.json');
  if (fs.existsSync(stateFile)) fs.rmSync(stateFile, { force: true });
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  delete process.env.STRIPE_SECRET_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('treasury state (settled-cash ledger)', () => {
  it('starts empty when no state file exists', async () => {
    const state = await readState();
    expect(state.revenueCents).toBe(0);
    expect(Object.keys(state.charges)).toHaveLength(0);
    expect(state.lastPulseStatus).toBe('not-configured');
  });

  it('recomputes revenue only from settled (succeeded), not refunded', async () => {
    const state = emptyTreasuryState();
    state.charges = {
      c1: { id: 'c1', amountCents: 25000, currency: 'usd', platform: 'justice', status: 'succeeded', createdAt: new Date().toISOString() },
      c2: { id: 'c2', amountCents: 10000, currency: 'usd', platform: 'cross-platform', status: 'refunded', createdAt: new Date().toISOString() },
      c3: { id: 'c3', amountCents: 5000, currency: 'usd', platform: 'health', status: 'succeeded', createdAt: new Date().toISOString() },
    };
    state.revenueCents = recomputeRevenueFromLedger(state);
    expect(state.revenueCents).toBe(30000);
    await writeState(state);
    expect(await settledRevenueUsd()).toBe(300);
  });

  it('round-trips state through the file', async () => {
    const state = emptyTreasuryState();
    state.revenueCents = 12345;
    await writeState(state);
    const reloaded = await readState();
    expect(reloaded.revenueCents).toBe(12345);
  });
});

describe('treasury pulse', () => {
  it('reports not-configured without STRIPE_SECRET_KEY and does not fabricate revenue', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const result = await runTreasuryPulse(30);
    expect(result.status).toBe('not-configured');
    expect(result.revenueUsd).toBe(0);
    expect(result.error).toContain('STRIPE_SECRET_KEY');
  });

  it('records an error status when the Stripe call fails', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test_invalid';
    // Point fetch at a deliberately failing path by stubbing global fetch.
    const original = global.fetch;
    global.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      const result = await runTreasuryPulse(30);
      expect(result.status).toBe('error');
      expect(result.error).toContain('network down');
    } finally {
      global.fetch = original;
    }
  });

  it('merges settled charges from a successful Stripe pull', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test_ok';
    const original = global.fetch;
    global.fetch = (async (url: unknown) => {
      const parsed = new URL(String(url));
      if (parsed.pathname !== '/v1/charges') throw new Error('wrong path');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          has_more: false,
          data: [
            { id: 'ch_1', amount: 25000, currency: 'usd', status: 'succeeded', refunded: false, created: Math.floor(Date.now() / 1000) - 3600, metadata: { platform: 'justice' } },
            { id: 'ch_2', amount: 15000, currency: 'usd', status: 'pending', refunded: false, created: Math.floor(Date.now() / 1000) - 7200, metadata: {} },
          ],
        }),
      };
    }) as typeof fetch;
    try {
      const result = await runTreasuryPulse(30);
      expect(result.status).toBe('ok');
      expect(result.revenueUsd).toBe(250); // only the succeeded charge counts
      expect(result.newSettled).toBe(1);
      const state = await readState();
      expect(state.charges['ch_2']!.status).toBe('pending');
    } finally {
      global.fetch = original;
    }
  });

  it('drops refunded charges from revenue on the next pulse', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test_refund';
    const original = global.fetch;
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        has_more: false,
        data: [
          { id: 'ch_1', amount: 25000, currency: 'usd', status: 'succeeded', refunded: true, created: Math.floor(Date.now() / 1000) - 3600, metadata: { platform: 'justice' } },
        ],
      }),
    })) as unknown as typeof fetch;
    try {
      const result = await runTreasuryPulse(30);
      expect(result.status).toBe('ok');
      expect(result.revenueUsd).toBe(0); // refunded â†’ excluded
    } finally {
      global.fetch = original;
    }
  });
});

describe('fetchStripeCharges', () => {
  it('throws when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(fetchStripeCharges(1, 2)).rejects.toThrow('STRIPE_SECRET_KEY');
  });

  it('throws for an inverted window', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_test_x';
    await expect(fetchStripeCharges(10, 5)).rejects.toThrow('invalid window');
  });
});
