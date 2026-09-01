import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyStripeSignature, recordChargeFromWebhook } from '../src/app/api/business/stripe-webhook/route';

const SECRET = 'whsec_testsecret';

function buildSignature(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const payload = `${t}.${rawBody}`;
  const v1 = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"id":"evt_1","type":"charge.succeeded"}';
    const sig = buildSignature(body, SECRET);
    expect(verifyStripeSignature(Buffer.from(body), sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"id":"evt_1","type":"charge.succeeded"}';
    const sig = buildSignature(body, SECRET);
    const tampered = '{"id":"evt_1","type":"charge.refunded"}';
    expect(verifyStripeSignature(Buffer.from(tampered), sig, SECRET)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = '{"id":"evt_1"}';
    const sig = buildSignature(body, 'whsec_wrong');
    expect(verifyStripeSignature(Buffer.from(body), sig, SECRET)).toBe(false);
  });

  it('rejects when the header is missing or malformed', () => {
    const body = '{"id":"evt_1"}';
    expect(verifyStripeSignature(Buffer.from(body), '', SECRET)).toBe(false);
    expect(verifyStripeSignature(Buffer.from(body), 'garbage', SECRET)).toBe(false);
  });
});

describe('recordChargeFromWebhook — settlement → delivery', () => {
  let registryDir: string;

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-webhook-'));
    process.env.DRAYMOND_REGISTRY_DIR = registryDir;
  });
  afterEach(() => {
    delete process.env.DRAYMOND_REGISTRY_DIR;
    try { fs.rmSync(registryDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('rejects test-mode events (never fabricates revenue)', async () => {
    const result = await recordChargeFromWebhook({
      id: 'evt_test',
      type: 'charge.succeeded',
      livemode: false,
      data: { object: { id: 'ch_test', amount: 50000, status: 'succeeded' } },
    });
    expect(result.recorded).toBe(false);
    expect(result.revenueUsd).toBe(0);
  });

  it('attributes a settled charge and dispatches delivery for audit', async () => {
    const dispatch = vi.fn(async () => ({ opportunityId: 'opp_1', ok: true, stage: 'invoiced', chainSlug: 'audit-delivery' }));
    vi.spyOn(await import('../src/lib/draymond/mission-delivery'), 'dispatchSettledDelivery').mockImplementation(dispatch);

    const result = await recordChargeFromWebhook({
      id: 'evt_1',
      type: 'charge.succeeded',
      livemode: true,
      data: {
        object: {
          id: 'ch_live_1',
          amount: 50000,
          status: 'succeeded',
          metadata: { service: 'audit', tier: 'deep', customerEmail: 'buyer@example.com' },
        },
      },
    });

    expect(result.recorded).toBe(true);
    expect(result.revenueUsd).toBe(500);
    expect(dispatch).toHaveBeenCalledWith({
      stripeChargeId: 'ch_live_1',
      serviceId: 'audit',
      tierId: 'deep',
      customerEmail: 'buyer@example.com',
    });

    vi.restoreAllMocks();
  });

  it('does not dispatch delivery for aetherdesk (webhook-driven line)', async () => {
    const dispatch = vi.fn();
    vi.spyOn(await import('../src/lib/draymond/mission-delivery'), 'dispatchSettledDelivery').mockImplementation(dispatch);

    await recordChargeFromWebhook({
      id: 'evt_2',
      type: 'charge.succeeded',
      livemode: true,
      data: {
        object: {
          id: 'ch_live_2',
          amount: 23900,
          status: 'succeeded',
          metadata: { service: 'aetherdesk', tier: 'month' },
        },
      },
    });

    expect(dispatch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
