import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-mission-pipeline-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// Mock the delivery chain runner so tests never hit the DB.
vi.mock('../src/lib/draymond/mission-delivery', () => ({
  runDeliveryChain: vi.fn(async (serviceId: string, input: Record<string, unknown>) => ({
    ok: true,
    chainSlug: `${serviceId}-delivery`,
    stepStatuses: { report: 'completed' },
  })),
}));

import {
  createInvoice,
  listInvoices,
  markInvoiceSettled,
  markDelivered,
  missionDashboard,
} from '../src/lib/draymond/mission-pipeline';
import { addOpportunity, updateOpportunityStage } from '../src/lib/draymond/business-pipeline';

beforeEach(() => {
  for (const f of ['business-pipeline.json', 'invoices.json']) {
    const p = path.join(tmp, f);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('mission pipeline', () => {
  it('creates an invoice for a won opportunity and advances it to invoiced', async () => {
    const opp = await addOpportunity({
      name: 'Audit - Client A', engine: 'E3-tooling', stage: 'won', monthlyValue: 500,
      owner: 'mission', nextAction: '', serviceId: 'audit', tierId: 'deep',
    });
    const invoice = await createInvoice(opp.id);
    expect(invoice.opportunityId).toBe(opp.id);
    expect(invoice.amountCents).toBe(50000);
    expect(invoice.status).toBe('open');
    const updated = await updateOpportunityStage(opp.id, 'invoiced');
    expect(updated?.stage).toBe('invoiced');
  });

  it('settles an invoice and flips it to paid', async () => {
    const opp = await addOpportunity({
      name: 'Research - Client B', engine: 'E4-vertical', stage: 'invoiced', monthlyValue: 1000,
      owner: 'mission', nextAction: '', serviceId: 'research', tierId: 'deep',
    });
    const invoice = await createInvoice(opp.id);
    await markInvoiceSettled(invoice.id, 'ch_test_1');
    const invoices = await listInvoices();
    expect(invoices.find((i) => i.id === invoice.id)?.status).toBe('paid');
    expect(invoices.find((i) => i.id === invoice.id)?.stripeChargeId).toBe('ch_test_1');
  });

  it('markDelivered advances won → invoiced and writes an invoice', async () => {
    const opp = await addOpportunity({
      name: 'MaaS - Client C', engine: 'E2-b2b', stage: 'won', monthlyValue: 1000,
      owner: 'mission', nextAction: '', serviceId: 'maas', tierId: 'growth',
    });
    const result = await markDelivered(opp.id);
    expect(result.invoice).toBeDefined();
    expect(result.opportunity?.stage).toBe('invoiced');
  });

  it('missionDashboard reports per-service won value and revenue', async () => {
    const opp = await addOpportunity({
      name: 'Audit - Client D', engine: 'E3-tooling', stage: 'invoiced', monthlyValue: 500,
      owner: 'mission', nextAction: '', serviceId: 'audit', tierId: 'deep',
    });
    const invoice = await createInvoice(opp.id);
    await markInvoiceSettled(invoice.id, 'ch_test_2');
    const dash = await missionDashboard();
    expect(dash.revenueUsd).toBe(500);
    expect(dash.byService.audit.won).toBe(500);
    expect(dash.byService.audit.paid).toBe(500);
  });
});
