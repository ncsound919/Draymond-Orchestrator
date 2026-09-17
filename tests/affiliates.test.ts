import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAffiliate,
  getAffiliateByCode,
  listAffiliates,
  recordAttribution,
  listCommissions,
  setCommissionStatus,
  setAffiliateActive,
  affiliateSummary,
  normalizeCode,
  tierRate,
  ROLE_RATES,
  PARENT_OVERRIDE_PCT,
} from '../src/lib/draymond/affiliates';

// Hermetic env: affiliates.json lives in the .draymond registry. Each test gets
// its own temp registry dir so state can never leak between cases.
let tmp = '';
const dirs: string[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-aff-'));
  dirs.push(tmp);
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('affiliates: registry', () => {
  it('creates affiliates and normalizes codes', async () => {
    const a = await createAffiliate({ code: ' Partner42 ', name: 'Partner', role: 'referrer' });
    expect(a.code).toBe('partner42');
    expect(normalizeCode('Foo Bar!!')).toBe('foobar');
    expect((await getAffiliateByCode('PARTNER42'))?.id).toBe(a.id);
    expect((await listAffiliates()).length).toBe(1);
  });

  it('rejects duplicate codes', async () => {
    await createAffiliate({ code: 'dup', name: 'A', role: 'referrer' });
    await expect(createAffiliate({ code: 'DUP', name: 'B', role: 'referrer' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('rejects an empty code', async () => {
    await expect(createAffiliate({ code: '!!!', name: 'A', role: 'referrer' })).rejects.toThrow(
      /code required/,
    );
  });
});

describe('affiliates: attribution + commissions', () => {
  it('accrues a direct commission on settled revenue', async () => {
    const a = await createAffiliate({ code: 'ref1', name: 'Ref', role: 'referrer' });
    const { commissions } = await recordAttribution('revenue', {
      code: 'ref1',
      customerId: 'cus_1',
      serviceId: 'aetherdesk',
      amountUsd: 500,
    });
    expect(commissions.length).toBe(1);
    expect(commissions[0]!.affiliateId).toBe(a.id);
    expect(commissions[0]!.amountCents).toBe(10_000); // 20% of $500
    expect(commissions[0]!.status).toBe('accrued');
  });

  it('pays no commission on a signup event', async () => {
    await createAffiliate({ code: 'ref2', name: 'Ref', role: 'referrer' });
    const { commissions } = await recordAttribution('signup', {
      code: 'ref2',
      customerId: 'cus_2',
    });
    expect(commissions).toEqual([]);
  });

  it('pays a parent override to the supervisor downline', async () => {
    const sup = await createAffiliate({ code: 'sup1', name: 'Sup', role: 'supervisor' });
    await createAffiliate({
      code: 'agent1',
      name: 'Agent',
      role: 'referrer',
      parentId: sup.id,
    });
    const { commissions } = await recordAttribution('revenue', {
      code: 'agent1',
      customerId: 'cus_3',
      amountUsd: 1000,
    });
    // direct (20%) + parent override (5%)
    expect(commissions.length).toBe(2);
    const direct = commissions.find((c) => !c.override)!;
    const override = commissions.find((c) => c.override)!;
    expect(direct.amountCents).toBe(20_000);
    expect(override.affiliateId).toBe(sup.id);
    expect(override.amountCents).toBe(5_000);
    expect(override.ratePct).toBe(PARENT_OVERRIDE_PCT);
  });

  it('pays no direct commission to an agent role (per-minute paid)', async () => {
    const sup = await createAffiliate({ code: 'sup2', name: 'Sup', role: 'supervisor' });
    await createAffiliate({ code: 'ag2', name: 'Agent', role: 'agent', parentId: sup.id });
    const { commissions } = await recordAttribution('revenue', {
      code: 'ag2',
      customerId: 'cus_4',
      amountUsd: 800,
    });
    // agent earns 0% direct; supervisor still gets the 5% override
    expect(commissions.length).toBe(1);
    expect(commissions[0]!.override).toBe(true);
  });

  it('skips the override when the parent is inactive', async () => {
    const sup = await createAffiliate({ code: 'sup3', name: 'Sup', role: 'supervisor' });
    await createAffiliate({ code: 'ref3', name: 'Ref', role: 'referrer', parentId: sup.id });
    await setAffiliateActive(sup.id, false);
    const { commissions } = await recordAttribution('revenue', {
      code: 'ref3',
      customerId: 'cus_5',
      amountUsd: 100,
    });
    expect(commissions.filter((c) => c.override)).toEqual([]);
  });

  it('rejects revenue attributed to an unknown code', async () => {
    await expect(
      recordAttribution('revenue', { code: 'nope', customerId: 'x', amountUsd: 10 }),
    ).rejects.toThrow(/unknown affiliate/);
  });
});

describe('affiliates: payout lifecycle + summary', () => {
  it('moves commissions accrued → approved → paid', async () => {
    await createAffiliate({ code: 'ref4', name: 'Ref', role: 'referrer' });
    const { commissions } = await recordAttribution('revenue', {
      code: 'ref4',
      customerId: 'cus_6',
      amountUsd: 250,
    });
    const id = commissions[0]!.id;
    await setCommissionStatus(id, 'approved');
    await setCommissionStatus(id, 'paid');
    const paid = await listCommissions({ status: 'paid' });
    expect(paid.length).toBe(1);
    expect(paid[0]!.amountCents).toBe(5_000);
  });

  it('summarizes the ledger', async () => {
    const a = await createAffiliate({ code: 'ref5', name: 'Ref', role: 'referrer' });
    await recordAttribution('signup', { code: 'ref5', customerId: 'cus_7' });
    await recordAttribution('revenue', { code: 'ref5', customerId: 'cus_7', amountUsd: 500 });
    const s = await affiliateSummary();
    expect(s.affiliates.total).toBe(1);
    expect(s.attributions).toEqual({ signups: 1, revenue: 1 });
    expect(s.commissions.accruedCents).toBe(10_000);
    expect(ROLE_RATES.referrer).toBe(20);
    expect(a.role).toBe('referrer');
  });

  it('tierRate mirrors the commission engine thresholds', () => {
    expect(tierRate(0)).toBe(10);
    expect(tierRate(100_000)).toBe(15);
    expect(tierRate(500_000)).toBe(20);
  });
});
