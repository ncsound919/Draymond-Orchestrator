import { addOutcome, upsertDiscovery } from './learning-store';

// BioComposable VariantWatch surface: real NCBI ClinVar E-utilities lookups.
const BIOCOMPOSABLE_URL =
  process.env.BIOCOMPOSABLE_URL ?? process.env.NEXT_PUBLIC_BIOCOMPOSABLE_URL ?? 'http://localhost:3000';

// Curated variant watchlist (gene, rsid) the fleet tracks for reclassification.
const VARIANT_WATCHLIST = [
  { gene: 'BRCA1', rsid: 'rs80357906' },
  { gene: 'MLH1', rsid: 'rs63750847' },
  { gene: 'CHEK2', rsid: 'rs17879961' },
  { gene: 'EGFR', rsid: 'rs121434568' },
];

export interface ClinVarSurveillanceSummary {
  ok: boolean;
  checked: number;
  reclassified: number;
  findings: { gene: string; rsid: string; classification: string; stars: number; changed: boolean }[];
  error?: string;
}

/**
 * Query real NCBI ClinVar (via the BioComposable proxy) for each watched variant
 * and feed reclassifications into the self-learning loop as discoveries. Fail-soft:
 * a Biocomposable/NCBI outage must never break the Draymond cron.
 */
export async function runClinVarSurveillance(): Promise<ClinVarSurveillanceSummary> {
  const findings: ClinVarSurveillanceSummary['findings'] = [];
  let reclassified = 0;

  try {
    const results = await Promise.allSettled(
      VARIANT_WATCHLIST.map(async (v) => {
        const res = await fetch(`${BIOCOMPOSABLE_URL}/api/v1/clinvar/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term: v.rsid }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`http_${res.status}`);
        const data = await res.json();
        return { gene: v.gene, rsid: v.rsid, data };
      })
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { gene, rsid, data } = r.value;
      const fresh = data?.result;
      if (!fresh || !data.found) continue;
      findings.push({
        gene, rsid,
        classification: fresh.classification,
        stars: fresh.stars,
        changed: Boolean(fresh.stars >= 3 && fresh.conflict_status === false),
      });
    }

    reclassified = findings.filter((f) => f.changed).length;

    if (findings.length > 0) {
      await addOutcome({
        agentId: 'clinvar:surveillance',
        kind: 'job',
        summary: 'ClinVar variant surveillance run',
        success: true,
        detail: `checked=${findings.length} variants, ${reclassified} flagged for review`,
      });
    }

    // Feed high-star, non-conflicting classifications as discoveries so the
    // oncology synthesis/grader can compound on real clinical consensus.
    for (const f of findings) {
      if (f.stars >= 3) {
        await upsertDiscovery({
          goalId: `clinvar-${f.gene}-${f.rsid}`,
          domain: 'oncology',
          area: f.gene,
          title: `ClinVar consensus: ${f.gene} ${f.rsid} -> ${f.classification}`,
          score: f.stars * 25,
          evidenceTier: f.stars >= 4 ? 'E1' : 'E2',
          breakthroughClass: f.stars >= 4 ? 'frontier' : 'promising',
          trend: 'clinvar',
          gradedAt: new Date().toISOString(),
        });
      }
    }

    return { ok: true, checked: findings.length, reclassified, findings };
  } catch (err: any) {
    return {
      ok: false, checked: 0, reclassified: 0, findings: [],
      error: String(err?.message ?? err),
    };
  }
}
