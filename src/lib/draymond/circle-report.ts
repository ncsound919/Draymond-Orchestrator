import fs from "node:fs/promises";
import path from "node:path";

export type CircleEngine = "E1" | "E2" | "E3" | "E4";

export const CIRCLE_ENGINES: readonly CircleEngine[] = ["E1", "E2", "E3", "E4"];

const BUILTIN_SERVICE_TO_ENGINE: Record<string, CircleEngine> = {
  aetherdesk: "E2",
  maas: "E2",
  audit: "E3",
  research: "E4",
};

const PRE_WON = new Set(["lead", "proposal", "negotiation"]);
const WON = new Set(["won", "delivering", "invoiced", "paid"]);

export interface CircleMission {
  id: string;
  goal?: string;
  status?: string;
  engine?: string;
  lane?: string;
  pillar?: string;
  scopingError?: string;
  tasks?: Array<{ status?: string; costUsd?: number | null }>;
}

export interface CircleOpportunity {
  id: string;
  engine?: string;
  stage?: string;
  monthlyValue?: number;
  serviceId?: string;
}

export interface CircleInvoice {
  id?: string;
  opportunityId?: string;
  serviceId?: string;
  amountCents?: number;
  status?: string;
}

export interface CircleEvidence {
  status?: string;
  refKind?: string;
}

export interface CircleInput {
  missions: CircleMission[];
  opportunities: CircleOpportunity[];
  invoices: CircleInvoice[];
  evidence: CircleEvidence[];
  treasuryRevenueCents: number;
  serviceToEngine: Record<string, CircleEngine>;
}

export interface EngineBucket {
  engine: CircleEngine;
  proposed: number;
  shipped: number;
  missions: number;
  settlementCents: number;
  costUsd: number;
  marginCents: number;
}

export interface CircleBrokenLinks {
  missionsWithoutEngine: string[];
  missionsWithoutLane: string[];
  opportunitiesWithoutEngine: string[];
  invoicesWithoutMappedService: string[];
}

export interface CircleReport {
  generatedAt: string;
  engines: EngineBucket[];
  totals: {
    proposed: number;
    shipped: number;
    missions: number;
    settlementCents: number;
    costUsd: number;
    marginCents: number;
    verifiedEvidence: number;
    unlinkedEvidence: number;
  };
  brokenLinks: CircleBrokenLinks;
  notes: string[];
}

export function normalizeEngine(raw: string | undefined): CircleEngine | undefined {
  if (!raw) return undefined;
  const m = /^E([1-4])/i.exec(raw.trim());
  return m ? (`E${m[1]}` as CircleEngine) : undefined;
}

function emptyBucket(engine: CircleEngine): EngineBucket {
  return { engine, proposed: 0, shipped: 0, missions: 0, settlementCents: 0, costUsd: 0, marginCents: 0 };
}

function missionCostUsd(mission: CircleMission): number {
  const tasks = Array.isArray(mission.tasks) ? mission.tasks : [];
  return tasks.reduce((sum, t) => sum + (typeof t.costUsd === "number" ? t.costUsd : 0), 0);
}

export function buildCircleReport(input: CircleInput, now = Date.now()): CircleReport {
  const buckets = new Map<CircleEngine, EngineBucket>();
  for (const engine of CIRCLE_ENGINES) buckets.set(engine, emptyBucket(engine));

  const broken: CircleBrokenLinks = {
    missionsWithoutEngine: [],
    missionsWithoutLane: [],
    opportunitiesWithoutEngine: [],
    invoicesWithoutMappedService: [],
  };

  for (const opp of input.opportunities) {
    const engine = normalizeEngine(opp.engine);
    if (!engine) {
      broken.opportunitiesWithoutEngine.push(opp.id);
      continue;
    }
    const bucket = buckets.get(engine)!;
    if (opp.stage && PRE_WON.has(opp.stage)) bucket.proposed += 1;
    if (opp.stage && WON.has(opp.stage)) bucket.shipped += 1;
  }

  for (const invoice of input.invoices) {
    const service = (invoice.serviceId ?? "").trim();
    const engine = service ? input.serviceToEngine[service] : undefined;
    if (!engine) {
      broken.invoicesWithoutMappedService.push(invoice.id ?? invoice.opportunityId ?? "unknown");
      continue;
    }
    if (invoice.status === "paid") {
      buckets.get(engine)!.settlementCents += Math.max(0, Number(invoice.amountCents) || 0);
    }
  }

  if (input.treasuryRevenueCents > 0) {
    buckets.get("E1")!.settlementCents += input.treasuryRevenueCents;
  }

  for (const mission of input.missions) {
    const engine = normalizeEngine(mission.engine);
    if (engine) buckets.get(engine)!.missions += 1;
    else broken.missionsWithoutEngine.push(mission.id);

    if (!mission.lane) broken.missionsWithoutLane.push(mission.id);
    if (engine) buckets.get(engine)!.costUsd += missionCostUsd(mission);
  }

  let verifiedEvidence = 0;
  for (const record of input.evidence) {
    if (record.status === "verified") verifiedEvidence += 1;
  }

  const engines = [...buckets.values()].map((bucket) => ({
    ...bucket,
    costUsd: Math.round(bucket.costUsd * 1e6) / 1e6,
    marginCents: bucket.settlementCents - Math.round(bucket.costUsd * 100),
  }));

  const totals = engines.reduce(
    (acc, bucket) => {
      acc.proposed += bucket.proposed;
      acc.shipped += bucket.shipped;
      acc.missions += bucket.missions;
      acc.settlementCents += bucket.settlementCents;
      acc.costUsd += bucket.costUsd;
      acc.marginCents += bucket.marginCents;
      return acc;
    },
    {
      proposed: 0,
      shipped: 0,
      missions: 0,
      settlementCents: 0,
      costUsd: 0,
      marginCents: 0,
      verifiedEvidence,
      unlinkedEvidence: verifiedEvidence,
    },
  );
  totals.costUsd = Math.round(totals.costUsd * 1e6) / 1e6;

  const notes: string[] = [];
  if (totals.unlinkedEvidence > 0) {
    notes.push(
      `${totals.unlinkedEvidence} verified evidence record(s) are not yet linked to a mission or opportunity (no refId join); they are excluded from per-engine attribution.`,
    );
  }
  if (broken.missionsWithoutLane.length > 0) {
    notes.push(
      `${broken.missionsWithoutLane.length} mission(s) have no audience lane; set AXIOM_MISSION_LANE or mission.lane to tag them.`,
    );
  }
  if (broken.missionsWithoutEngine.length > 0) {
    notes.push(
      `${broken.missionsWithoutEngine.length} mission(s) have no engine; set AXIOM_MISSION_PILLAR so inferEngine can stamp E1-E4.`,
    );
  }
  if (broken.invoicesWithoutMappedService.length > 0) {
    notes.push(
      `${broken.invoicesWithoutMappedService.length} invoice(s) have no mapped serviceId; settlement is not attributed to an engine.`,
    );
  }

  return {
    generatedAt: new Date(now).toISOString(),
    engines,
    totals,
    brokenLinks: broken,
    notes,
  };
}

export function renderCircleReportMarkdown(report: CircleReport): string {
  const lines: string[] = [];
  lines.push("# Circle Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("Settled money only; pipeline is never revenue. Untagged work is reported as broken links, never inferred.");
  lines.push("");
  lines.push("## By engine");
  lines.push("");
  lines.push("| Engine | Proposed | Shipped | Missions | Cost USD | Settled USD | Margin USD |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const b of report.engines) {
    lines.push(
      `| ${b.engine} | ${b.proposed} | ${b.shipped} | ${b.missions} | ${b.costUsd.toFixed(4)} | ${(b.settlementCents / 100).toFixed(2)} | ${(b.marginCents / 100).toFixed(2)} |`,
    );
  }
  lines.push("");
  lines.push("## Totals");
  lines.push("");
  lines.push(`- Proposed: ${report.totals.proposed}`);
  lines.push(`- Shipped: ${report.totals.shipped}`);
  lines.push(`- Missions: ${report.totals.missions}`);
  lines.push(`- Cost USD: ${report.totals.costUsd.toFixed(4)}`);
  lines.push(`- Settled USD: ${(report.totals.settlementCents / 100).toFixed(2)}`);
  lines.push(`- Margin USD: ${(report.totals.marginCents / 100).toFixed(2)}`);
  lines.push(`- Verified evidence: ${report.totals.verifiedEvidence} (unlinked: ${report.totals.unlinkedEvidence})`);
  lines.push("");
  lines.push("## Broken links");
  lines.push("");
  lines.push(`- Missions without engine: ${report.brokenLinks.missionsWithoutEngine.length}`);
  lines.push(`- Missions without lane: ${report.brokenLinks.missionsWithoutLane.length}`);
  lines.push(`- Opportunities without engine: ${report.brokenLinks.opportunitiesWithoutEngine.length}`);
  lines.push(`- Invoices without mapped service: ${report.brokenLinks.invoicesWithoutMappedService.length}`);
  if (report.notes.length) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) lines.push(`- ${note}`);
  }
  return lines.join("\n") + "\n";
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
}

function outputDir(): string {
  return process.env.DRAYMOND_CIRCLE_REPORT_DIR ?? path.join(process.cwd(), "data");
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readMissions(dir: string): Promise<CircleMission[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const missions: CircleMission[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const record = await readJson<CircleMission | null>(path.join(dir, name), null);
    if (record && typeof record.id === "string") missions.push(record);
  }
  return missions;
}

async function readServiceToEngine(): Promise<Record<string, CircleEngine>> {
  const taxonomy = await readJson<{ service_to_engine?: Record<string, string> }>(
    path.join(process.cwd(), "config", "workforce", "engines.json"),
    {},
  );
  const out: Record<string, CircleEngine> = { ...BUILTIN_SERVICE_TO_ENGINE };
  for (const [service, engine] of Object.entries(taxonomy.service_to_engine ?? {})) {
    const normalized = normalizeEngine(engine);
    if (normalized) out[service] = normalized;
  }
  return out;
}

export async function collectCircleInput(): Promise<CircleInput> {
  const dir = registryDir();
  const [missions, pipeline, invoices, evidence, treasury, serviceToEngine] = await Promise.all([
    readMissions(path.join(dir, "missions")),
    readJson<{ opportunities?: CircleOpportunity[] }>(path.join(dir, "business-pipeline.json"), {}),
    readJson<{ invoices?: CircleInvoice[] }>(path.join(dir, "invoices.json"), {}),
    readJson<{ records?: CircleEvidence[] }>(path.join(dir, "evidence-ledger.json"), {}),
    readJson<{ revenueCents?: number }>(path.join(dir, "treasury.json"), {}),
    readServiceToEngine(),
  ]);
  return {
    missions,
    opportunities: Array.isArray(pipeline.opportunities) ? pipeline.opportunities : [],
    invoices: Array.isArray(invoices.invoices) ? invoices.invoices : [],
    evidence: Array.isArray(evidence.records) ? evidence.records : [],
    treasuryRevenueCents: typeof treasury.revenueCents === "number" ? treasury.revenueCents : 0,
    serviceToEngine,
  };
}

export interface CircleWriteResult {
  report: CircleReport;
  jsonPath: string;
  mdPath: string;
}

export async function writeCircleReport(): Promise<CircleWriteResult> {
  const dir = outputDir();
  const input = await collectCircleInput();
  const report = buildCircleReport(input);
  const jsonPath = path.join(dir, "circle-report.json");
  const mdPath = path.join(dir, "circle-report.md");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(mdPath, renderCircleReportMarkdown(report), "utf-8");
  return { report, jsonPath, mdPath };
}
