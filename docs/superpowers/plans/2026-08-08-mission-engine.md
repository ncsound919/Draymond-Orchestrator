# Mission Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a unified business ecosystem in Draymond: revenue-driving delivery chains (Aetherdesk rental/MaaS/audit/research), a pipeline automaton (`won → delivering → invoiced → paid`), and a configured financial strategy with Stripe pricing.

**Architecture:** New `mission-*` modules in `src/lib/draymond/` reuse the existing chain engine (`chains.ts`), scheduler (`scheduler.ts`), treasury (`treasury-state.ts`), and business pipeline (`business-pipeline.ts`). State is JSON in `.draymond/` (matches the existing pattern — no DB migration). Stripe prices for all 4 service lines already exist (created 2026-08-08, see `.draymond/stripe-pricing.json`).

**Tech Stack:** Next.js 16 / TypeScript / Vitest / Stripe REST / better-sqlite3-backed supabase-compatible client.

**Running checks:** `npm run type-check` · `npm test` · `npm run lint` (run from `Draymond-Orchestrator/`).

**Key entity slugs (chain-callable, all online):** `grader` (grade), `reporank` (scan), `mutly` (analyze), `kaggle` (research_feed), `uplift-agent` (batch). `omni-research` + `social-media-dashboard` need their invocation configs enriched (Task 3) before chains can call them.

---

## File Map

- **Create** `src/lib/draymond/mission-strategy.ts` — service catalog + targets + unit economics.
- **Create** `src/lib/draymond/mission-pipeline.ts` — invoice ledger + stage automaton + dashboard KPI.
- **Create** `src/lib/draymond/mission-chains.ts` — 3 chain template seeds (idempotent).
- **Create** `src/lib/draymond/mission-delivery.ts` — dispatch glue (opportunity → chain → advance).
- **Create** `src/app/api/mission/strategy/route.ts`, `src/app/api/mission/dispatch/route.ts`, `src/app/api/mission/dashboard/route.ts`.
- **Modify** `src/lib/draymond/business-pipeline.ts` — extend `OpportunityStage` + optional `serviceId`/`tierId` on `Opportunity`.
- **Modify** `src/lib/draymond/seed.ts` — enrich `social-media-dashboard` + `omni-research` invocation configs.
- **Modify** `src/lib/draymond/scheduler.ts` — 3 custom handlers + 3 seeded jobs.
- **Modify** `src/app/api/business/opportunities/route.ts` — allow new stages in STAGES array.
- **Test** `tests/mission-strategy.test.ts`, `tests/mission-pipeline.test.ts`, `tests/mission-chains.test.ts`.

---

## Task 1: Mission strategy module

**Files:**
- Create: `src/lib/draymond/mission-strategy.ts`
- Test: `tests/mission-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readStrategy,
  writeStrategy,
  getService,
  serviceTargets,
  totalMonthlyTarget,
  unitEconomics,
  DEFAULT_STRATEGY,
} from '../src/lib/draymond/mission-strategy';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-mission-strategy-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

beforeEach(() => {
  const f = path.join(tmp, 'mission-strategy.json');
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
});

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('mission strategy', () => {
  it('defaults to the 4-service catalog', async () => {
    const s = await readStrategy();
    expect(s.services.map((x) => x.id).sort()).toEqual(['aetherdesk', 'audit', 'maas', 'research']);
    expect(totalMonthlyTarget(s)).toBe(5000);
  });

  it('persists and reloads a strategy', async () => {
    await writeStrategy({ ...DEFAULT_STRATEGY, services: DEFAULT_STRATEGY.services.map((x) => x.id === 'maas' ? { ...x, targetMonthly: 3000 } : x) });
    const s = await readStrategy();
    expect(getService(s, 'maas')!.targetMonthly).toBe(3000);
  });

  it('computes unit economics gross margin per service', async () => {
    const s = await readStrategy();
    for (const svc of s.services) {
      const ue = unitEconomics(svc);
      expect(ue.marginPct).toBeGreaterThan(0);
      expect(ue.marginPct).toBeLessThan(100);
      expect(ue.tier).toBe(svc.tiers[0]!.id);
    }
  });

  it('sums service targets', async () => {
    const s = await readStrategy();
    expect(serviceTargets(s)).toEqual({
      aetherdesk: 1000, maas: 2000, audit: 1000, research: 1000,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mission-strategy.test.ts`
Expected: FAIL — module `../src/lib/draymond/mission-strategy` not found.

- [ ] **Step 3: Implement `mission-strategy.ts`**

```typescript
/**
 * Mission strategy — configured financial model for the 4 service lines.
 *
 * State lives in .draymond/mission-strategy.json (JSON-state pattern, no DB).
 * Every service maps to live Stripe products/prices (see .draymond/stripe-pricing.json).
 */

import fs from "node:fs/promises";
import path from "node:path";

export type ServiceId = "aetherdesk" | "maas" | "audit" | "research";
export type BillingModel = "recurring_monthly" | "one_time" | "one_time_rental";

export interface ServiceTier {
  id: string;
  name: string;
  priceCents: number;
  billing: BillingModel;
  stripePriceId: string;
}

export interface ServiceLine {
  id: ServiceId;
  name: string;
  agents: string[];
  skills: string[];
  deliveryCostCents: number;
  targetMonthly: number;
  billing: BillingModel;
  tiers: ServiceTier[];
}

export interface MissionStrategy {
  services: ServiceLine[];
  totalMonthlyTarget: number;
  firstDollarByDay: number;
  runwayDays: number;
  updatedAt: string;
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(registryDir(), "mission-strategy.json");
}

const STRIPE = {
  maas: {
    starter: { priceId: "price_1U2JTkQrfNRBru0z2et9pdou", cents: 50000 },
    growth: { priceId: "price_1U2JTsQrfNRBru0z0AaEA9YF", cents: 100000 },
    scale: { priceId: "price_1U2JTtQrfNRBru0zAcI0Dx4t", cents: 150000 },
  },
  audit: {
    standard: { priceId: "price_1U2JTuQrfNRBru0zifMHiEYo", cents: 25000 },
    deep: { priceId: "price_1U2JTvQrfNRBru0zWYwlpwfg", cents: 50000 },
    enterprise: { priceId: "price_1U2JTwQrfNRBru0zggUucOS8", cents: 100000 },
  },
  research: {
    brief: { priceId: "price_1U2JTxQrfNRBru0znwDZA8sb", cents: 50000 },
    deep: { priceId: "price_1U2JTyQrfNRBru0zFa8JVdSX", cents: 100000 },
    custom: { priceId: "price_1U2JTzQrfNRBru0zQ8w9xKTj", cents: 200000 },
  },
  aetherdesk: {
    hour: { priceId: "price_1U2JgaQrfNRBru0zimyABYTi", cents: 200 },
    four_hour: { priceId: "price_1U2JgbQrfNRBru0zvEHOPDGf", cents: 720 },
    day: { priceId: "price_1U2JgdQrfNRBru0zb9Ckikb6", cents: 1330 },
    week: { priceId: "price_1U2JgfQrfNRBru0zCJTVcAEp", cents: 6400 },
    month: { priceId: "price_1U2JghQrfNRBru0zjvbVmGW8", cents: 23900 },
    quarter: { priceId: "price_1U2JgjQrfNRBru0zldCaqb6x", cents: 64400 },
    half_year: { priceId: "price_1U2JgkQrfNRBru0z2vejAzA9", cents: 120400 },
    year: { priceId: "price_1U2JgmQrfNRBru0zNi5TRMiF", cents: 223900 },
  },
};

export const DEFAULT_STRATEGY: MissionStrategy = {
  totalMonthlyTarget: 5000,
  firstDollarByDay: 30,
  runwayDays: 90,
  updatedAt: new Date().toISOString(),
  services: [
    {
      id: "aetherdesk",
      name: "Aetherdesk AI Call Center",
      agents: ["aetherdesk-platform"],
      skills: [],
      deliveryCostCents: 60, // ~$0.60 per rental hour (infra + LLM)
      targetMonthly: 1000,
      billing: "one_time_rental",
      tiers: [
        { id: "hour", name: "1 Hour", priceCents: 200, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.hour.priceId },
        { id: "four_hour", name: "4 Hours", priceCents: 720, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.four_hour.priceId },
        { id: "day", name: "Day", priceCents: 1330, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.day.priceId },
        { id: "week", name: "Week", priceCents: 6400, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.week.priceId },
        { id: "month", name: "Month", priceCents: 23900, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.month.priceId },
        { id: "quarter", name: "Quarter", priceCents: 64400, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.quarter.priceId },
        { id: "half_year", name: "6 Months", priceCents: 120400, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.half_year.priceId },
        { id: "year", name: "Year", priceCents: 223900, billing: "one_time_rental", stripePriceId: STRIPE.aetherdesk.year.priceId },
      ],
    },
    {
      id: "maas",
      name: "Marketing-as-a-Service",
      agents: ["social-media-dashboard", "omni-research", "mutly", "uplift-agent"],
      skills: ["seo-content-writer", "blog-writer", "content-strategy", "marketing-mode", "web-search"],
      deliveryCostCents: 2000, // ~$20 tokens per monthly package
      targetMonthly: 2000,
      billing: "recurring_monthly",
      tiers: [
        { id: "starter", name: "Starter", priceCents: 50000, billing: "recurring_monthly", stripePriceId: STRIPE.maas.starter.priceId },
        { id: "growth", name: "Growth", priceCents: 100000, billing: "recurring_monthly", stripePriceId: STRIPE.maas.growth.priceId },
        { id: "scale", name: "Scale", priceCents: 150000, billing: "recurring_monthly", stripePriceId: STRIPE.maas.scale.priceId },
      ],
    },
    {
      id: "audit",
      name: "Codebase Audit & QA",
      agents: ["grader", "reporank", "mutly", "uplift-agent"],
      skills: ["skill-vetter", "coding-agent", "ecc-e2e-testing"],
      deliveryCostCents: 800, // ~$8 per audit
      targetMonthly: 1000,
      billing: "one_time",
      tiers: [
        { id: "standard", name: "Standard", priceCents: 25000, billing: "one_time", stripePriceId: STRIPE.audit.standard.priceId },
        { id: "deep", name: "Deep", priceCents: 50000, billing: "one_time", stripePriceId: STRIPE.audit.deep.priceId },
        { id: "enterprise", name: "Enterprise", priceCents: 100000, billing: "one_time", stripePriceId: STRIPE.audit.enterprise.priceId },
      ],
    },
    {
      id: "research",
      name: "Research Brief",
      agents: ["omni-research", "kaggle", "uplift-agent"],
      skills: ["market-research-reports", "qingyan-research", "multi-search-engine"],
      deliveryCostCents: 1500, // ~$15 per brief
      targetMonthly: 1000,
      billing: "one_time",
      tiers: [
        { id: "brief", name: "Brief", priceCents: 50000, billing: "one_time", stripePriceId: STRIPE.research.brief.priceId },
        { id: "deep", name: "Deep", priceCents: 100000, billing: "one_time", stripePriceId: STRIPE.research.deep.priceId },
        { id: "custom", name: "Custom", priceCents: 200000, billing: "one_time", stripePriceId: STRIPE.research.custom.priceId },
      ],
    },
  ],
};

export async function readStrategy(): Promise<MissionStrategy> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as MissionStrategy;
    if (!Array.isArray(parsed.services) || parsed.services.length === 0) return DEFAULT_STRATEGY;
    return parsed;
  } catch {
    return DEFAULT_STRATEGY;
  }
}

export async function writeStrategy(s: MissionStrategy): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  const toWrite = { ...s, updatedAt: new Date().toISOString() };
  await fs.writeFile(FILE(), JSON.stringify(toWrite, null, 2), "utf-8");
}

export function getService(s: MissionStrategy, id: ServiceId): ServiceLine | undefined {
  return s.services.find((x) => x.id === id);
}

export function totalMonthlyTarget(s: MissionStrategy): number {
  return s.services.reduce((sum, x) => sum + x.targetMonthly, 0);
}

export function serviceTargets(s: MissionStrategy): Record<ServiceId, number> {
  return {
    aetherdesk: getService(s, "aetherdesk")?.targetMonthly ?? 0,
    maas: getService(s, "maas")?.targetMonthly ?? 0,
    audit: getService(s, "audit")?.targetMonthly ?? 0,
    research: getService(s, "research")?.targetMonthly ?? 0,
  };
}

export function unitEconomics(svc: ServiceLine): { tier: string; priceCents: number; costCents: number; marginCents: number; marginPct: number } {
  const tier = svc.tiers[0]!;
  const marginCents = tier.priceCents - svc.deliveryCostCents;
  const marginPct = Math.round((marginCents / tier.priceCents) * 100);
  return { tier: tier.id, priceCents: tier.priceCents, costCents: svc.deliveryCostCents, marginCents, marginPct };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mission-strategy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/draymond/mission-strategy.ts tests/mission-strategy.test.ts
git commit -m "feat(mission): mission strategy module - service catalog, targets, unit economics"
```

---

## Task 2: Extend opportunity stages + mission pipeline automaton

**Files:**
- Modify: `src/lib/draymond/business-pipeline.ts`
- Modify: `src/app/api/business/opportunities/route.ts`
- Create: `src/lib/draymond/mission-pipeline.ts`
- Test: `tests/mission-pipeline.test.ts`

- [ ] **Step 1: Extend `OpportunityStage` and `Opportunity` in `business-pipeline.ts`**

In `src/lib/draymond/business-pipeline.ts`, change:

```typescript
export type OpportunityStage = "lead" | "proposal" | "negotiation" | "won" | "lost";
```

to:

```typescript
export type OpportunityStage = "lead" | "proposal" | "negotiation" | "won" | "delivering" | "invoiced" | "paid" | "lost";
```

Then in the `Opportunity` interface add two optional fields after `monthlyValue`:

```typescript
  /** Mission service line this opportunity belongs to (aetherdesk|maas|audit|research). */
  serviceId?: string;
  /** Selected pricing tier id from the service catalog. */
  tierId?: string;
```

In `pipelineSummary`, update the `byStage` initialization to include the new stages:

```typescript
const byStage: Record<OpportunityStage, number> = { lead: 0, proposal: 0, negotiation: 0, won: 0, delivering: 0, invoiced: 0, paid: 0, lost: 0 };
```

In the `won`/`delivering`/`invoiced`/`paid` counting, treat all four as won-value (they are closed business):

```typescript
  for (const o of ops) {
    byStage[o.stage] += 1;
    const engine = byEngine[o.engine];
    if (o.stage === "won" || o.stage === "delivering" || o.stage === "invoiced" || o.stage === "paid") {
      wonMonthlyValue += o.monthlyValue;
      engine.won += o.monthlyValue;
    } else if (o.stage !== "lost") {
      activePipelineValue += o.monthlyValue;
      engine.active += o.monthlyValue;
    }
  }
```

- [ ] **Step 2: Allow the new stages in the opportunities API**

In `src/app/api/business/opportunities/route.ts`, replace:

```typescript
const STAGES = ['lead', 'proposal', 'negotiation', 'won', 'lost'];
```

with:

```typescript
const STAGES = ['lead', 'proposal', 'negotiation', 'won', 'delivering', 'invoiced', 'paid', 'lost'];
```

Also extend the POST body destructuring to accept `serviceId` and `tierId` and pass them through:

```typescript
  const { name, engine, stage, monthlyValue, owner, nextAction, serviceId, tierId } = body;
```

and in `addOpportunity(...)`:

```typescript
  const opp = await addOpportunity({
    name,
    engine: engine as never,
    stage: stage as never,
    monthlyValue: value,
    owner: typeof owner === 'string' ? owner : 'draymond',
    nextAction: typeof nextAction === 'string' ? nextAction : '',
    serviceId: typeof serviceId === 'string' ? serviceId : undefined,
    tierId: typeof tierId === 'string' ? tierId : undefined,
  });
```

Also update `business-pipeline.ts` `addOpportunity` signature so it accepts the optional fields:

```typescript
export interface Opportunity {
  // ... existing fields
  serviceId?: string;
  tierId?: string;
}
```

and in `addOpportunity`:

```typescript
export async function addOpportunity(input: Omit<Opportunity, "id" | "createdAt" | "updatedAt">): Promise<Opportunity> {
  const now = new Date().toISOString();
  const opp: Opportunity = { ...input, id: `opp_${Date.now()}`, createdAt: now, updatedAt: now };
  // ... unchanged
}
```

- [ ] **Step 3: Write the failing mission-pipeline test**

```typescript
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
    const ops = await import('../src/lib/draymond/business-pipeline');
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run tests/mission-pipeline.test.ts`
Expected: FAIL — `../src/lib/draymond/mission-pipeline` not found.

- [ ] **Step 5: Implement `mission-pipeline.ts`**

```typescript
/**
 * Mission pipeline — invoice ledger + stage automaton for the 4 service lines.
 *
 * Advances opportunities won → delivering → invoiced → paid from delivery
 * chain outcomes and settled Stripe charges. Invoices live in
 * .draymond/invoices.json (JSON-state pattern).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readStrategy, getService, type ServiceId } from "./mission-strategy";
import { listOpportunities, updateOpportunityStage, type Opportunity } from "./business-pipeline";

export type InvoiceStatus = "open" | "paid";

export interface Invoice {
  id: string;
  opportunityId: string;
  serviceId: ServiceId;
  tierId: string;
  amountCents: number;
  status: InvoiceStatus;
  stripeChargeId?: string;
  createdAt: string;
  paidAt?: string;
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(registryDir(), "invoices.json");
}

async function readInvoices(): Promise<Invoice[]> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as { invoices?: Invoice[] };
    return Array.isArray(parsed.invoices) ? parsed.invoices : [];
  } catch {
    return [];
  }
}

async function writeInvoices(invoices: Invoice[]): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  await fs.writeFile(FILE(), JSON.stringify({ invoices, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

export async function listInvoices(): Promise<Invoice[]> {
  return readInvoices();
}

export async function createInvoice(opportunityId: string): Promise<Invoice> {
  const [ops, strategy] = await Promise.all([listOpportunities(), readStrategy()]);
  const opp = ops.find((o) => o.id === opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);
  const serviceId = (opp.serviceId ?? "audit") as ServiceId;
  const svc = getService(strategy, serviceId);
  if (!svc) throw new Error(`Service ${serviceId} not in strategy`);
  const tier = svc.tiers.find((t) => t.id === opp.tierId) ?? svc.tiers[0]!;
  const invoice: Invoice = {
    id: `inv_${Date.now()}`,
    opportunityId,
    serviceId,
    tierId: tier.id,
    amountCents: tier.priceCents,
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const invoices = await readInvoices();
  invoices.push(invoice);
  await writeInvoices(invoices);
  return invoice;
}

export async function markInvoiceSettled(invoiceId: string, stripeChargeId: string): Promise<Invoice | null> {
  const invoices = await readInvoices();
  const invoice = invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;
  invoice.status = "paid";
  invoice.stripeChargeId = stripeChargeId;
  invoice.paidAt = new Date().toISOString();
  await writeInvoices(invoices);
  // Advance the linked opportunity to paid.
  await updateOpportunityStage(invoice.opportunityId, "paid").catch(() => {});
  return invoice;
}

export async function markDelivered(opportunityId: string): Promise<{ invoice: Invoice; opportunity: Opportunity | null }> {
  await updateOpportunityStage(opportunityId, "delivering");
  const invoice = await createInvoice(opportunityId);
  await updateOpportunityStage(opportunityId, "invoiced");
  const ops = await listOpportunities();
  const opportunity = ops.find((o) => o.id === opportunityId) ?? null;
  return { invoice, opportunity };
}

export interface MissionDashboard {
  revenueUsd: number;
  totalMonthlyTarget: number;
  byService: Record<ServiceId, { target: number; won: number; paid: number }>;
  opportunities: { total: number; byStage: Record<string, number> };
  velocity: { leads: number; won: number; invoiced: number; paid: number };
}

export async function missionDashboard(): Promise<MissionDashboard> {
  const [ops, invoices, strategy] = await Promise.all([listOpportunities(), readInvoices(), readStrategy()]);
  const byService: Record<ServiceId, { target: number; won: number; paid: number }> = {
    aetherdesk: { target: 0, won: 0, paid: 0 },
    maas: { target: 0, won: 0, paid: 0 },
    audit: { target: 0, won: 0, paid: 0 },
    research: { target: 0, won: 0, paid: 0 },
  };
  for (const svc of strategy.services) byService[svc.id] = { target: svc.targetMonthly, won: 0, paid: 0 };

  const byStage: Record<string, number> = {};
  for (const o of ops) {
    byStage[o.stage] = (byStage[o.stage] ?? 0) + 1;
    const sid = (o.serviceId ?? "audit") as ServiceId;
    if (o.stage === "won" || o.stage === "delivering" || o.stage === "invoiced" || o.stage === "paid") {
      byService[sid].won += o.monthlyValue;
    }
  }

  let revenueUsd = 0;
  for (const inv of invoices) {
    if (inv.status === "paid") {
      revenueUsd += Math.round(inv.amountCents / 100);
      byService[inv.serviceId].paid += Math.round(inv.amountCents / 100);
    }
  }

  return {
    revenueUsd,
    totalMonthlyTarget: strategy.services.reduce((s, x) => s + x.targetMonthly, 0),
    byService,
    opportunities: { total: ops.length, byStage },
    velocity: {
      leads: byStage["lead"] ?? 0,
      won: byStage["won"] ?? 0,
      invoiced: byStage["invoiced"] ?? 0,
      paid: byStage["paid"] ?? 0,
    },
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/mission-pipeline.test.ts`
Expected: PASS (4 tests).

Run: `npx vitest run tests/business-pipeline.test.ts`
Expected: PASS (existing 4 tests still green — the `byStage` shape change must not break assertions; verify).

- [ ] **Step 7: Commit**

```bash
git add src/lib/draymond/business-pipeline.ts src/lib/draymond/mission-pipeline.ts src/app/api/business/opportunities/route.ts tests/mission-pipeline.test.ts
git commit -m "feat(mission): pipeline automaton - invoices, won->invoiced->paid stage machine"
```

---

## Task 3: Enrich entity invocation configs for chain-callable content/research

**Files:**
- Modify: `src/lib/draymond/seed.ts` (the `social-media-dashboard` entity ~line 440 and `omni-research` entity ~line 458)

- [ ] **Step 1: Add a working invocation config to `social-media-dashboard`**

Replace the `social-media-dashboard` entity block (currently `invocation_method: 'api_call'` with no config) so it becomes HTTP-callable. Change to:

```typescript
    invocation_method: 'http_api',
    invocation_config: {
      url: process.env.SOCIAL_MEDIA_URL || 'http://localhost:8030',
      method: 'POST',
      timeout_ms: 120000,
      endpoints: {
        generate_text: { path: '/api/ai/generate-text', method: 'POST' },
        generate_image: { path: '/api/ai/generate-image', method: 'POST' },
        generate_video: { path: '/api/ai/generate-video', method: 'POST' },
        schedule_posts: { path: '/api/ai/schedule', method: 'POST' },
      },
      requires_env: ['SOCIAL_MEDIA_URL'],
    },
```

- [ ] **Step 2: Add a working invocation config to `omni-research`**

Replace the `omni-research` entity block's `invocation_config` (currently only `requires_env`) with:

```typescript
    invocation_config: {
      url: process.env.OMNI_RESEARCH_URL || 'http://localhost:3010',
      method: 'POST',
      timeout_ms: 120000,
      endpoints: {
        trending_topics: { path: '/api/trending-topics', method: 'POST' },
        research_news: { path: '/api/research', method: 'POST' },
        web_search: { path: '/api/web-search', method: 'POST' },
      },
      requires_env: ['GEMINI_API_KEY'],
    },
```

- [ ] **Step 3: Verify type-check + existing tests still pass**

Run: `npm run type-check` and `npx vitest run tests/registry.test.ts tests/entities-kind.test.ts`
Expected: PASS (no registry shape assertions depend on these two entities' invocation configs; if any test asserts `api_call` for social-media-dashboard, update it).

- [ ] **Step 4: Commit**

```bash
git add src/lib/draymond/seed.ts
git commit -m "feat(seed): make social-media-dashboard and omni-research chain-callable (http_api endpoints)"
```

---

## Task 4: Mission chain templates + seed

**Files:**
- Create: `src/lib/draymond/mission-chains.ts`
- Test: `tests/mission-chains.test.ts`

- [ ] **Step 1: Write the failing test (pure-definition checks — no DB needed)**

```typescript
import { describe, expect, it } from 'vitest';
import { MISSION_CHAIN_DEFS } from '../src/lib/draymond/mission-chains';

describe('mission chain templates', () => {
  it('defines the three delivery chains', () => {
    const slugs = MISSION_CHAIN_DEFS.map((c) => c.slug).sort();
    expect(slugs).toEqual(['audit-delivery', 'maas-monthly-cycle', 'research-brief-delivery']);
  });

  it('references only known entity slugs and valid actions', () => {
    const known = new Set([
      'grader', 'reporank', 'mutly', 'uplift-agent',
      'omni-research', 'social-media-dashboard', 'kaggle',
    ]);
    for (const chain of MISSION_CHAIN_DEFS) {
      for (const step of chain.steps) {
        expect(known.has(step.entitySlug), `${chain.slug}:${step.name} -> ${step.entitySlug}`).toBe(true);
        expect(step.action.length).toBeGreaterThan(0);
        expect(step.step_order).toBeGreaterThan(0);
      }
    }
  });

  it('orders steps so dependents have higher step_order', () => {
    for (const chain of MISSION_CHAIN_DEFS) {
      const byOrder = new Map(chain.steps.map((s) => [s.name, s.step_order]));
      for (const step of chain.steps) {
        for (const depName of step.depends_on) {
          const depOrder = byOrder.get(depName);
          expect(depOrder, `${chain.slug}: ${step.name} depends on ${depName}`).toBeLessThan(step.step_order);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mission-chains.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mission-chains.ts`**

```typescript
/**
 * Mission chains — revenue delivery chain template definitions + idempotent
 * seeding. Reuses the chains engine (createChain/addSteps) and the
 * requireEntityBySlug pattern from chains-seed.ts.
 */

import { createChain, addSteps, getChain } from "./chains";
import type { DraymondChain } from "./types";

export interface MissionStepDef {
  name: string;
  entitySlug: string;
  action: string;
  input_mapping: Record<string, unknown>;
  output_key: string;
  step_order: number;
  parallel_group?: string;
  /** Step names this step depends on (resolved to ids after creation). */
  depends_on: string[];
}

export interface MissionChainDef {
  slug: string;
  name: string;
  description: string;
  input: Record<string, unknown>;
  steps: MissionStepDef[];
}

export const MISSION_CHAIN_DEFS: MissionChainDef[] = [
  {
    slug: "maas-monthly-cycle",
    name: "MaaS Monthly Cycle",
    description: "Marketing-as-a-Service monthly deliverable: research trends, draft content + assets, QA gate, compile client package.",
    input: { niche: "local business", brand_voice: "professional", image_style: "modern" },
    steps: [
      { name: "Research Trends", entitySlug: "omni-research", action: "trending_topics", input_mapping: { niche: "$.input.niche" }, output_key: "trending", step_order: 1, depends_on: [] },
      { name: "Draft Content", entitySlug: "social-media-dashboard", action: "generate_text", input_mapping: { topics: "$.steps.trending.output", brand: "$.input.brand_voice" }, output_key: "content", step_order: 2, depends_on: ["Research Trends"] },
      { name: "Generate Assets", entitySlug: "social-media-dashboard", action: "generate_image", input_mapping: { content: "$.steps.content.output", style: "$.input.image_style" }, output_key: "images", step_order: 2, parallel_group: "content_gen", depends_on: ["Research Trends"] },
      { name: "Format QA", entitySlug: "mutly", action: "analyze", input_mapping: { content: "$.steps.content.output", images: "$.steps.images.output" }, output_key: "qa", step_order: 3, depends_on: ["Draft Content", "Generate Assets"] },
      { name: "Compile Client Package", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_maas_package", content: "$.steps.content.output", images: "$.steps.images.output", qa: "$.steps.qa.output" }, output_key: "package", step_order: 4, depends_on: ["Format QA"] },
    ],
  },
  {
    slug: "audit-delivery",
    name: "Audit Delivery",
    description: "Codebase audit deliverable: grade repo, deep scan, QA gate, compile audit report.",
    input: { repoUrl: "" },
    steps: [
      { name: "Grade Repo", entitySlug: "grader", action: "grade", input_mapping: { repoUrl: "$.input.repoUrl" }, output_key: "grade", step_order: 1, depends_on: [] },
      { name: "Deep Scan", entitySlug: "reporank", action: "scan", input_mapping: { repoUrl: "$.input.repoUrl" }, output_key: "scan", step_order: 1, parallel_group: "audit_scan", depends_on: [] },
      { name: "QA Gate", entitySlug: "mutly", action: "analyze", input_mapping: { repoUrl: "$.input.repoUrl", grade: "$.steps.grade.output", scan: "$.steps.scan.output" }, output_key: "qa", step_order: 2, depends_on: ["Grade Repo", "Deep Scan"] },
      { name: "Compile Audit Report", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_audit_report", repoUrl: "$.input.repoUrl", grade: "$.steps.grade.output", scan: "$.steps.scan.output", qa: "$.steps.qa.output" }, output_key: "report", step_order: 3, depends_on: ["QA Gate"] },
    ],
  },
  {
    slug: "research-brief-delivery",
    name: "Research Brief Delivery",
    description: "Research brief deliverable: deep research + data feed, then synthesize a grounded brief.",
    input: { topic: "", dataset: "nathanlauga/nba-games", tags: "research", force: false },
    steps: [
      { name: "Deep Research", entitySlug: "omni-research", action: "research_news", input_mapping: { query: "$.input.topic" }, output_key: "research", step_order: 1, depends_on: [] },
      { name: "Data Feed", entitySlug: "kaggle", action: "research_feed", input_mapping: { dataset: "$.input.dataset", tags: "$.input.tags", force: "$.input.force" }, output_key: "feed", step_order: 1, parallel_group: "research_gather", depends_on: [] },
      { name: "Synthesize Brief", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_research_brief", topic: "$.input.topic", research: "$.steps.research.output", feed: "$.steps.feed.output" }, output_key: "brief", step_order: 2, depends_on: ["Deep Research", "Data Feed"] },
    ],
  },
];

async function requireEntityBySlug(slug: string): Promise<string> {
  const { getEntity } = await import("./registry");
  const entity = await getEntity(slug);
  if (!entity) throw new Error(`[Mission Chains] Entity "${slug}" not in registry`);
  return entity.id;
}

/**
 * Seed the three mission chain templates (idempotent — skips existing slugs).
 * Returns ids of chains that already exist or were newly created.
 */
export async function seedMissionChains(): Promise<Array<{ name: string; slug: string; id: string }>> {
  const result: Array<{ name: string; slug: string; id: string }> = [];

  for (const def of MISSION_CHAIN_DEFS) {
    const existing = await getChain(def.slug);
    if (existing) {
      result.push({ name: def.name, slug: def.slug, id: existing.id });
      continue;
    }

    const entityIds: Record<string, string> = {};
    for (const step of def.steps) {
      if (!entityIds[step.entitySlug]) entityIds[step.entitySlug] = await requireEntityBySlug(step.entitySlug);
    }

    const chain: DraymondChain = await createChain({
      name: def.name,
      slug: def.slug,
      description: def.description,
      version: "1.0.0",
      is_template: true,
      status: "draft",
      trigger_type: "manual",
      input_data: def.input,
      context: {},
      max_retries: 2,
    });

    const created = await addSteps(
      def.steps.map((s) => ({
        chain_id: chain.id,
        step_order: s.step_order,
        name: s.name,
        entity_id: entityIds[s.entitySlug],
        action: s.action,
        input_mapping: s.input_mapping,
        output_key: s.output_key,
        depends_on_steps: [], // remapped below
        parallel_group: s.parallel_group,
        risk_level: s.name.startsWith("QA") ? "medium" : "low",
        max_retries: 2,
      }))
    );

    const byName = new Map(created.map((st) => [st.name, st]));
    const depPatches: Array<{ id: string; depends_on_steps: string[] }> = [];
    for (let i = 0; i < def.steps.length; i++) {
      const s = def.steps[i]!;
      const target = byName.get(s.name);
      if (!target) continue;
      const deps = s.depends_on.map((d) => byName.get(d)?.id).filter((x): x is string => Boolean(x));
      depPatches.push({ id: target.id, depends_on_steps: deps });
    }

    const { createDraymondClient } = await import("./client");
    const supabase = await createDraymondClient();
    for (const patch of depPatches) {
      const { error } = await supabase.from("draymond_chain_steps").update({ depends_on_steps: patch.depends_on_steps }).eq("id", patch.id);
      if (error) console.error(`[Mission Chains] dep patch failed for ${patch.id}: ${error.message}`);
    }
    await supabase.from("draymond_chains").update({ total_steps: created.length }).eq("id", chain.id);

    result.push({ name: def.name, slug: def.slug, id: chain.id });
  }

  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mission-chains.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: clean (watch for the `DraymondChain` import usage — it is a type; ensure `import type { DraymondChain }` if `verbatimModuleSyntax` complains; adjust import accordingly).

- [ ] **Step 6: Commit**

```bash
git add src/lib/draymond/mission-chains.ts tests/mission-chains.test.ts
git commit -m "feat(mission): three revenue delivery chain templates + idempotent seed"
```

---

## Task 5: Delivery dispatch glue

**Files:**
- Create: `src/lib/draymond/mission-delivery.ts`

- [ ] **Step 1: Implement `mission-delivery.ts`**

```typescript
/**
 * Mission delivery — dispatch glue. Maps a won opportunity to its service's
 * delivery chain, runs it, and advances the pipeline on a QA-gated result.
 */

import { instantiateChain, executeChain } from "./chains";
import { listOpportunities } from "./business-pipeline";
import { markDelivered } from "./mission-pipeline";
import { getService, readStrategy, type ServiceId } from "./mission-strategy";

const SERVICE_CHAIN: Record<ServiceId, string> = {
  aetherdesk: "audit-delivery", // placeholder: aetherdesk uses its own platform webhook
  maas: "maas-monthly-cycle",
  audit: "audit-delivery",
  research: "research-brief-delivery",
};

export interface DeliveryResult {
  opportunityId: string;
  ok: boolean;
  stage: string;
  invoice?: { id: string; amountCents: number };
  error?: string;
  chainSlug?: string;
  stepStatuses?: Record<string, string>;
}

export async function dispatchDelivery(opportunityId: string): Promise<DeliveryResult> {
  const ops = await listOpportunities();
  const opp = ops.find((o) => o.id === opportunityId);
  if (!opp) return { opportunityId, ok: false, stage: "unknown", error: "opportunity not found" };
  if (opp.stage !== "won" && opp.stage !== "delivering") {
    return { opportunityId, ok: false, stage: opp.stage, error: `opportunity must be 'won' or 'delivering' to dispatch (was '${opp.stage}')` };
  }

  const serviceId = (opp.serviceId ?? "audit") as ServiceId;
  const strategy = await readStrategy();
  const svc = getService(strategy, serviceId);
  if (!svc) return { opportunityId, ok: false, stage: opp.stage, error: `service ${serviceId} not in strategy` };

  const chainSlug = SERVICE_CHAIN[serviceId];
  const input: Record<string, unknown> = {
    ...opp,
    niche: opp.name,
    repoUrl: (opp as unknown as Record<string, string>).repoUrl ?? opp.name,
    topic: opp.name,
    brand_voice: "professional",
  };

  try {
    const instance = await instantiateChain(chainSlug, input, undefined, "mission-engine");
    const ctx = await executeChain(instance.id, "mission-engine");

    const stepStatuses: Record<string, string> = {};
    for (const [key, st] of Object.entries(ctx.steps ?? {})) stepStatuses[key] = st.status;

    const values = Object.values(ctx.steps ?? {});
    const failed = values.filter((s) => s.status === "failed" || s.status === "blocked" || s.status === "retrying");
    if (failed.length > 0) {
      return {
        opportunityId, ok: false, stage: opp.stage, chainSlug, stepStatuses,
        error: `${failed.length} step(s) failed`,
      };
    }

    const delivered = await markDelivered(opportunityId);
    return {
      opportunityId,
      ok: true,
      stage: delivered.opportunity?.stage ?? "invoiced",
      invoice: { id: delivered.invoice.id, amountCents: delivered.invoice.amountCents },
      chainSlug,
      stepStatuses,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const { recordOutcome } = await import("./self-learning");
      await recordOutcome({
        agentId: "mission-engine",
        kind: "incident",
        summary: `mission dispatch failed: ${chainSlug} for ${opportunityId}`,
        success: false,
        detail: msg.slice(0, 500),
      });
    } catch { /* best-effort */ }
    return { opportunityId, ok: false, stage: opp.stage, chainSlug, error: msg };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: clean. (If `ctx.steps` values have non-indexable status, cast to `{ status: string }`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/draymond/mission-delivery.ts
git commit -m "feat(mission): delivery dispatch - opportunity to chain to invoiced"
```

---

## Task 6: Mission API routes

**Files:**
- Create: `src/app/api/mission/strategy/route.ts`
- Create: `src/app/api/mission/dispatch/route.ts`
- Create: `src/app/api/mission/dashboard/route.ts`

- [ ] **Step 1: Implement the three routes**

`src/app/api/mission/strategy/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { readStrategy, totalMonthlyTarget, unitEconomics } from '@/lib/draymond/mission-strategy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = authorizeRequest(new NextRequest('http://localhost'));
  if (authError) return authError;
  const strategy = await readStrategy();
  return NextResponse.json({
    ...strategy,
    totalMonthlyTarget: totalMonthlyTarget(strategy),
    unitEconomics: strategy.services.map((s) => ({ service: s.id, ...unitEconomics(s) })),
  });
}
```

`src/app/api/mission/dispatch/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { dispatchDelivery } from '@/lib/draymond/mission-delivery';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const opportunityId = typeof body.opportunityId === 'string' ? body.opportunityId : '';
  if (!opportunityId) {
    return NextResponse.json({ error: 'opportunityId is required' }, { status: 400 });
  }

  const result = await dispatchDelivery(opportunityId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
```

`src/app/api/mission/dashboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { missionDashboard } from '@/lib/draymond/mission-pipeline';

export const dynamic = 'force-dynamic';

export async function GET() {
  const authError = authorizeRequest(new NextRequest('http://localhost'));
  if (authError) return authError;
  return NextResponse.json(await missionDashboard());
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npm run type-check` and `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mission/strategy/route.ts src/app/api/mission/dispatch/route.ts src/app/api/mission/dashboard/route.ts
git commit -m "feat(api): mission strategy/dispatch/dashboard routes"
```

---

## Task 7: Scheduler handlers + seeded jobs

**Files:**
- Modify: `src/lib/draymond/scheduler.ts`

- [ ] **Step 1: Add custom handlers in `executeJobByType`**

Inside the `case 'custom':` block of `executeJobByType`, before the final `console.log(...)` fallback, add three handlers:

```typescript
      if (handler === 'mission_strategy_review') {
        const { missionDashboard } = await import('./mission-pipeline');
        const { readStrategy, totalMonthlyTarget } = await import('./mission-strategy');
        const { settledRevenueUsd } = await import('./treasury-state');
        const [dash, strategy, revenue] = await Promise.all([missionDashboard(), readStrategy(), settledRevenueUsd()]);
        const target = totalMonthlyTarget(strategy);
        const memo = [
          '# Mission Strategy Review',
          '',
          `**Settled revenue to date: $${revenue}** (target: $${target}/mo by day ${strategy.runwayDays})`,
          `**Pipeline:** ${dash.opportunities.total} opps · ${dash.velocity.leads} leads · ${dash.velocity.won} won · ${dash.velocity.invoiced} invoiced · ${dash.velocity.paid} paid`,
          '',
          '| Service | Target | Won (USD) | Paid (USD) |',
          '|---|---|---|---|',
          ...strategy.services.map((s) => `| ${s.name} | $${s.targetMonthly} | $${dash.byService[s.id].won} | $${dash.byService[s.id].paid} |`),
          '',
          `Revenue vs target: ${revenue >= target ? 'ON TARGET' : `$${Math.max(0, target - revenue)} short`}`,
        ].join('\n');
        try {
          const { sendNotification } = await import('./notifications');
          await sendNotification({
            channel: 'email',
            recipient: process.env.DRAYMOND_ALERT_EMAIL ?? process.env.GMAIL_USER ?? 'admin@localhost',
            subject: 'Mission Strategy Review',
            body: memo,
            type: 'custom',
            priority: 'normal',
          });
        } catch (e) { console.error('[scheduler] mission strategy review notify failed:', e); }
        return { handler, revenue, target, memo: memo.slice(0, 1500) };
      }

      if (handler === 'mission_pipeline_sync') {
        const { missionDashboard } = await import('./mission-pipeline');
        const { listOpportunities } = await import('./business-pipeline');
        const dash = await missionDashboard();
        const ops = await listOpportunities();
        // Flag leads older than 14 days as stale (diagnostic only — no mutation).
        const stale = ops.filter((o) => o.stage === 'lead' && Date.now() - new Date(o.updatedAt).getTime() > 14 * 86400_000);
        return { handler, total: dash.opportunities.total, byStage: dash.opportunities.byStage, staleLeads: stale.map((o) => o.id) };
      }

      if (handler === 'mission_run_maas_cycle') {
        const { listOpportunities } = await import('./business-pipeline');
        const { dispatchDelivery } = await import('./mission-delivery');
        const clients = (await listOpportunities()).filter((o) => o.serviceId === 'maas' && (o.stage === 'won' || o.stage === 'delivering'));
        const results = [];
        for (const c of clients.slice(0, 10)) results.push(await dispatchDelivery(c.id));
        return { handler, clients: clients.length, results };
      }
```

- [ ] **Step 2: Seed the three jobs**

Add to the `BASIC_JOBS` array (before the closing `];`):

```typescript
  {
    name: 'Mission Pipeline Sync',
    description: 'Daily 6am — reconcile opportunity stages, flag stale leads, compute mission KPIs.',
    cron_expression: '0 6 * * *',
    job_type: 'custom',
    job_config: { handler: 'mission_pipeline_sync' },
    is_enabled: true,
  },
  {
    name: 'Mission Strategy Review',
    description: 'Weekly Monday 8am — pipeline + settled revenue vs target, emailed strategy memo.',
    cron_expression: '0 8 * * 1',
    job_type: 'custom',
    job_config: { handler: 'mission_strategy_review' },
    is_enabled: true,
  },
  {
    name: 'MaaS Monthly Cycle',
    description: 'Weekly Monday 9am — run the MaaS delivery chain for each active MaaS client.',
    cron_expression: '0 9 * * 1',
    job_type: 'custom',
    job_config: { handler: 'mission_run_maas_cycle' },
    is_enabled: true,
  },
```

- [ ] **Step 3: Verify existing scheduler tests + add a smoke check**

Run: `npx vitest run tests/scheduler.test.ts tests/scheduler-cron.test.ts`
Expected: PASS.

- [ ] **Step 4: Type-check + commit**

Run: `npm run type-check`
Expected: clean.

```bash
git add src/lib/draymond/scheduler.ts
git commit -m "feat(scheduler): mission strategy review, pipeline sync, maas cycle handlers + jobs"
```

---

## Task 8: Full verification + seed wiring

**Files:**
- No new files.

- [ ] **Step 1: Run the full suite**

Run: `npm run type-check`
Run: `npm test`
Run: `npm run lint`
Expected: all green. Fix any failures introduced by the stage-type change (e.g. tests that enumerate stage counts).

- [ ] **Step 2: Seed the mission chains into the live registry**

From `Draymond-Orchestrator/`, run once so the chain templates exist for the running app:

```bash
node -e "require('tsx/cjs').register && import('./src/lib/draymond/mission-chains.ts').then(m => m.seedMissionChains()).then(r => { console.log('seeded:', r); process.exit(0) })"
```

Expected: logs the 3 chain template ids (or the existing ids if already seeded). If tsx import fails, use `npx tsx -e "import('./src/lib/draymond/mission-chains.ts').then(m=>m.seedMissionChains()).then(console.log)"`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(mission): verification pass + seed mission chains"
```

---

## Self-Review (verify against spec)

1. **§3 service catalog / §3.1 pricing** → Task 1 (`mission-strategy.ts`) + `.draymond/stripe-pricing.json` (exists).
2. **§4.1 chains (3 templates, QA gate, invoiceReady)** → Task 4 (`mission-chains.ts`); QA gate step present in maas + audit chains.
3. **§4.1 pipeline automaton + invoices** → Task 2 (`mission-pipeline.ts`, stage extension).
4. **§4.1 delivery dispatch** → Task 5 (`mission-delivery.ts`).
5. **§4.2 seed enrichment** → Task 3.
6. **§4.3 API routes** → Task 6.
7. **§5 scheduled jobs** → Task 7.
8. **§6 determinism guards** → settled-cash-only via `treasury-state`; QA gate; `recordOutcome` on failures; dispatch requires `won`.
9. **§8 testing** → `tests/mission-strategy.test.ts`, `tests/mission-pipeline.test.ts`, `tests/mission-chains.test.ts`.
10. **§10 acceptance criteria** → all covered by Tasks 1–7.

**Type consistency:** `ServiceId`/`ServiceLine`/`Invoice`/`InvoiceStatus`/`DeliveryResult`/`MissionDashboard` defined once (Task 1/2/5) and reused everywhere. `Opportunity.serviceId`/`tierId` added once (Task 2). Chain step `depends_on` uses step *names*, resolved to ids in `seedMissionChains` (Task 4) — never mixed with the engine's `depends_on_steps` ids.
