import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckoutSession } from '../src/lib/draymond/mission-checkout';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-mission-checkout-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

const originalFetch = globalThis.fetch;
const originalKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  const f = path.join(tmp, 'mission-strategy.json');
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});

function mockStripeResponse(overrides: Partial<{ id: string; url: string }> = {}) {
  globalThis.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1', ...overrides }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  ) as unknown as typeof fetch;
}

describe('mission checkout', () => {
  it('creates a payment-mode session for an audit tier with metadata', async () => {
    mockStripeResponse();
    const result = await createCheckoutSession({ serviceId: 'audit', tierId: 'deep' });

    expect(result.url).toContain('checkout.stripe.com');
    expect(result.mode).toBe('payment');

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = call[1]?.body as string;
    expect(body).toContain('mode=payment');
    expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_1U2JTvQrfNRBru0zWYwlpwfg');
    expect(body).toContain('metadata%5Bservice%5D=audit');
    expect(body).toContain('metadata%5Btier%5D=deep');
  });

  it('uses subscription mode for maas and passes opportunityId metadata', async () => {
    mockStripeResponse();
    await createCheckoutSession({ serviceId: 'maas', tierId: 'growth', opportunityId: 'opp_123' });

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = call[1]?.body as string;
    expect(body).toContain('mode=subscription');
    expect(body).toContain('line_items%5B0%5D%5Bprice%5D=price_1U2JTsQrfNRBru0z0AaEA9YF');
    expect(body).toContain('metadata%5BopportunityId%5D=opp_123');
  });

  it('throws when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createCheckoutSession({ serviceId: 'audit', tierId: 'standard' })).rejects.toThrow(
      'STRIPE_SECRET_KEY not configured'
    );
  });

  it('throws for an unknown service/tier', async () => {
    await expect(createCheckoutSession({ serviceId: 'audit', tierId: 'nope' })).rejects.toThrow(
      'unknown service/tier'
    );
  });
});
