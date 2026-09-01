/**
 * Mission Control — business pipeline for the 90-day six-figure target.
 *
 * Tracks opportunities (leads → proposals → closed), engine revenue targets,
 * and weekly KPI vs the $33k/mo goal. Deterministic, evidence-based: pipeline
 * value is NOT revenue — only settled cash counts toward the target.
 */

import fs from "node:fs/promises";
import path from "node:path";

export type OpportunityStage = "lead" | "proposal" | "negotiation" | "won" | "delivering" | "invoiced" | "paid" | "lost";
export type RevenueEngine = "E1-platform" | "E2-b2b" | "E3-tooling" | "E4-vertical";

export interface Opportunity {
  id: string;
  name: string;
  engine: RevenueEngine;
  stage: OpportunityStage;
  /** Expected monthly value in USD once won. */
  monthlyValue: number;
  /** Mission service line this opportunity belongs to (aetherdesk|maas|audit|research). */
  serviceId?: string;
  /** Selected pricing tier id from the service catalog. */
  tierId?: string;
  /** Stripe charge id that settled this order (storefront auto-opportunities). */
  stripeChargeId?: string;
  owner: string; // the agent/product delivering it
  nextAction: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineTarget {
  engine: RevenueEngine;
  monthlyTarget: number;
}

export const ENGINE_TARGETS: EngineTarget[] = [
  { engine: "E1-platform", monthlyTarget: 10_000 },
  { engine: "E2-b2b", monthlyTarget: 12_000 },
  { engine: "E3-tooling", monthlyTarget: 6_000 },
  { engine: "E4-vertical", monthlyTarget: 5_000 },
];

export const MONTHLY_TARGET = ENGINE_TARGETS.reduce((s, e) => s + e.monthlyTarget, 0); // 33,000

/** Resolved lazily so tests (fresh temp dirs per case) and prod both work. */
function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}
function FILE(): string {
  return path.join(registryDir(), "business-pipeline.json");
}

async function readOpportunities(): Promise<Opportunity[]> {
  try {
    const raw = await fs.readFile(FILE(), "utf-8");
    const parsed = JSON.parse(raw) as { opportunities?: Opportunity[] };
    return Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
  } catch {
    return [];
  }
}

async function writeOpportunities(ops: Opportunity[]): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  await fs.writeFile(FILE(), JSON.stringify({ opportunities: ops, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

export async function listOpportunities(): Promise<Opportunity[]> {
  return readOpportunities();
}

export async function addOpportunity(input: Omit<Opportunity, "id" | "createdAt" | "updatedAt">): Promise<Opportunity> {
  const now = new Date().toISOString();
  const opp: Opportunity = { ...input, id: `opp_${Date.now()}`, createdAt: now, updatedAt: now };
  const ops = await readOpportunities();
  ops.push(opp);
  await writeOpportunities(ops);
  return opp;
}

export async function updateOpportunityStage(id: string, stage: OpportunityStage): Promise<Opportunity | null> {
  const ops = await readOpportunities();
  const opp = ops.find((o) => o.id === id);
  if (!opp) return null;
  opp.stage = stage;
  opp.updatedAt = new Date().toISOString();
  await writeOpportunities(ops);
  return opp;
}

export interface PipelineSummary {
  monthlyTarget: number;
  opportunities: {
    total: number;
    byStage: Record<OpportunityStage, number>;
    activePipelineValue: number; // sum of lead/proposal/negotiation monthlyValue
    wonMonthlyValue: number; // sum of won monthlyValue
  };
  byEngine: Record<RevenueEngine, { target: number; active: number; won: number }>;
  /** Revenue-to-date (USD) — must come from the Treasurer, never estimated. */
  revenueToDate: number;
  /** Mission strategy monthly target ($5k by day 90) when configured; falls back to MONTHLY_TARGET. */
  missionMonthlyTarget: number;
  /** Required daily run-rate to hit the target by day 90. */
  requiredDaily: number;
}

export async function pipelineSummary(revenueToDate = 0): Promise<PipelineSummary> {
  const ops = await readOpportunities();
  // Mission strategy-driven target (replaces the hardcoded $33k fiction when
  // the mission config exists); falls back to engine targets otherwise.
  let missionMonthlyTarget = MONTHLY_TARGET;
  try {
    const { readStrategy, totalMonthlyTarget } = await import("./mission-strategy");
    const strategy = await readStrategy();
    if (Array.isArray(strategy.services) && strategy.services.length > 0) {
      missionMonthlyTarget = totalMonthlyTarget(strategy);
    }
  } catch {
    /* strategy unavailable — keep engine targets */
  }
  const byStage: Record<OpportunityStage, number> = { lead: 0, proposal: 0, negotiation: 0, won: 0, delivering: 0, invoiced: 0, paid: 0, lost: 0 };
  const byEngine: Record<RevenueEngine, { target: number; active: number; won: number }> = {
    "E1-platform": { target: 10_000, active: 0, won: 0 },
    "E2-b2b": { target: 12_000, active: 0, won: 0 },
    "E3-tooling": { target: 6_000, active: 0, won: 0 },
    "E4-vertical": { target: 5_000, active: 0, won: 0 },
  };

  let activePipelineValue = 0;
  let wonMonthlyValue = 0;
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

  return {
    monthlyTarget: MONTHLY_TARGET,
    opportunities: {
      total: ops.length,
      byStage,
      activePipelineValue,
      wonMonthlyValue,
    },
    byEngine,
    revenueToDate,
    missionMonthlyTarget,
    requiredDaily: Math.round(((missionMonthlyTarget * 3) - revenueToDate) / Math.max(1, 90)),
  };
}
