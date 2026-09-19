import { describe, expect, it } from "vitest";
import { buildCircleReport, normalizeEngine, renderCircleReportMarkdown } from "../src/lib/draymond/circle-report";

const base = {
  serviceToEngine: { aetherdesk: "E2", maas: "E2", audit: "E3", research: "E4" },
} as const;

describe("normalizeEngine", () => {
  it("normalizes both Axiom (E3) and Draymond (E3-tooling) forms", () => {
    expect(normalizeEngine("E3")).toBe("E3");
    expect(normalizeEngine("E3-tooling")).toBe("E3");
    expect(normalizeEngine("E1-platform")).toBe("E1");
    expect(normalizeEngine("")).toBeUndefined();
    expect(normalizeEngine(undefined)).toBeUndefined();
  });
});

describe("buildCircleReport", () => {
  it("attributes settled invoices by service and costs by mission engine", () => {
    const report = buildCircleReport({
      ...base,
      missions: [
        { id: "m1", engine: "E3-tooling", lane: "tech", tasks: [{ costUsd: 0.5 }, { costUsd: 0.25 }] },
      ],
      opportunities: [
        { id: "o1", engine: "E3-tooling", stage: "proposal" },
        { id: "o2", engine: "E3-tooling", stage: "won" },
      ],
      invoices: [
        { id: "i1", serviceId: "audit", amountCents: 50000, status: "paid" },
        { id: "i2", serviceId: "audit", amountCents: 10000, status: "open" },
      ],
      evidence: [{ status: "verified" }, { status: "proposed" }],
      treasuryRevenueCents: 0,
    });
    const e3 = report.engines.find((b) => b.engine === "E3")!;
    expect(e3.proposed).toBe(1);
    expect(e3.shipped).toBe(1);
    expect(e3.missions).toBe(1);
    expect(e3.settlementCents).toBe(50000);
    expect(e3.costUsd).toBeCloseTo(0.75, 6);
    expect(e3.marginCents).toBe(49925);
    expect(report.totals.verifiedEvidence).toBe(1);
    expect(report.totals.unlinkedEvidence).toBe(1);
  });

  it("records broken links instead of guessing", () => {
    const report = buildCircleReport({
      ...base,
      missions: [{ id: "m1", tasks: [] }, { id: "m2", engine: "E2-b2b" }],
      opportunities: [{ id: "o1", stage: "lead" }],
      invoices: [{ id: "i1", serviceId: "unknown-service", amountCents: 100, status: "paid" }],
      evidence: [],
      treasuryRevenueCents: 0,
    });
    expect(report.brokenLinks.missionsWithoutEngine).toEqual(["m1"]);
    expect(report.brokenLinks.missionsWithoutLane).toEqual(["m1", "m2"]);
    expect(report.brokenLinks.opportunitiesWithoutEngine).toEqual(["o1"]);
    expect(report.brokenLinks.invoicesWithoutMappedService).toEqual(["i1"]);
    expect(report.totals.settlementCents).toBe(0);
  });

  it("adds treasury revenue to the E1 platform bucket", () => {
    const report = buildCircleReport({
      ...base,
      missions: [],
      opportunities: [],
      invoices: [],
      evidence: [],
      treasuryRevenueCents: 12345,
    });
    expect(report.engines.find((b) => b.engine === "E1")!.settlementCents).toBe(12345);
  });
});

describe("renderCircleReportMarkdown", () => {
  it("states the settled-only rule and lists every engine", () => {
    const md = renderCircleReportMarkdown(
      buildCircleReport({ ...base, missions: [], opportunities: [], invoices: [], evidence: [], treasuryRevenueCents: 0 }),
    );
    expect(md).toContain("Settled money only");
    for (const engine of ["E1", "E2", "E3", "E4"]) expect(md).toContain(`| ${engine} |`);
  });
});
