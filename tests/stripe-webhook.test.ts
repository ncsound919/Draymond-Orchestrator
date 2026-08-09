import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from '../src/app/api/business/stripe-webhook/route';

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
