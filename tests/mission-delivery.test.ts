import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolation: never touch the real .draymond brain state.
let registryDir: string;
beforeEach(() => {
  registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-mission-delivery-'));
  process.env.DRAYMOND_REGISTRY_DIR = registryDir;
});
afterEach(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  try { fs.rmSync(registryDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// The delivery chain executor is heavy/DB-backed — mock the chain engine so the
// test exercises the settlement→opportunity→dispatch wiring, not the chain run.
vi.mock('../src/lib/draymond/chains', () => ({
  instantiateChain: vi.fn(async () => ({ id: 'inst_1' })),
  executeChain: vi.fn(async () => ({
    steps: { s1: { status: 'completed' }, s2: { status: 'completed' } },
  })),
}));

import { dispatchSettledDelivery } from '../src/lib/draymond/mission-delivery';
import { listOpportunities } from '../src/lib/draymond/business-pipeline';

describe('dispatchSettledDelivery', () => {
  it('creates a won opportunity from the settled charge and dispatches delivery', async () => {
    const result = await dispatchSettledDelivery({
      stripeChargeId: 'ch_123',
      serviceId: 'audit',
      tierId: 'deep',
      customerEmail: 'buyer@example.com',
    });

    expect(result.ok).toBe(true);
    expect(result.chainSlug).toBe('audit-delivery');
    expect(result.opportunityId).toBeTruthy();

    const ops = await listOpportunities();
    expect(ops).toHaveLength(1);
    const opp = ops[0]!;
    expect(opp.serviceId).toBe('audit');
    expect(opp.tierId).toBe('deep');
    expect(opp.stripeChargeId).toBe('ch_123');
    expect(opp.stage).toBe('invoiced'); // dispatch advances won → delivering → invoiced
  });

  it('is idempotent across webhook retries (same stripe charge id)', async () => {
    const first = await dispatchSettledDelivery({ stripeChargeId: 'ch_retry', serviceId: 'research', tierId: 'brief' });
    const second = await dispatchSettledDelivery({ stripeChargeId: 'ch_retry', serviceId: 'research', tierId: 'brief' });

    // Same opportunity reused — no duplicate.
    expect(second.opportunityId).toBe(first.opportunityId);
    const ops = await listOpportunities();
    expect(ops).toHaveLength(1);
  });

  it('falls back to the first tier when the tier id is unknown', async () => {
    const result = await dispatchSettledDelivery({ stripeChargeId: 'ch_4', serviceId: 'maas', tierId: 'nope' });
    expect(result.ok).toBe(true);
    const ops = await listOpportunities();
    expect(ops[0]!.tierId).toBe('starter');
  });
});