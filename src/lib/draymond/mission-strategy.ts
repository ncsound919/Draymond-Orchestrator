import { writeBrainFile } from './journal';
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
      deliveryCostCents: 60,
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
      deliveryCostCents: 2000,
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
      deliveryCostCents: 800,
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
      agents: ["omni-research", "kaggle", "uplift-agent", "bookbridge"],
      skills: ["market-research-reports", "qingyan-research", "multi-search-engine", "book-bridge", "book-to-skill", "book-to-skill-chain", "book-synthesis-personal"],
      deliveryCostCents: 1500,
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
  const toWrite = { ...s, updatedAt: new Date().toISOString() };
  await writeBrainFile(FILE(), JSON.stringify(toWrite, null, 2), "write", "mission-strategy");
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
