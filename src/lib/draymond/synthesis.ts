import { addOutcome, upsertDiscovery } from './learning-store';

const ONCOLOGY_SYNTHESIS_URL =
  process.env.ONCOLOGY_URL ?? process.env.NEXT_PUBLIC_ONCOLOGY_URL ?? 'http://localhost:3070/api/research/synthesis';

// BioComposable surface that records synthesis insights so research depth flows
// from the Oncology system into variant-surveillance.
const BIOCOMPOSABLE_URL =
  process.env.BIOCOMPOSABLE_URL ?? process.env.NEXT_PUBLIC_BIOCOMPOSABLE_URL ?? 'http://localhost:3000';

export interface SynthesisRunSummary {
  ok: boolean;
  synthesized: string[];
  outlookCount: number;
  breakthroughCount: number;
  thresholdsChanged: boolean;
  error?: string;
}

/**
 * Run the synthesis phase by calling the Oncology synthesis route, then feed
 * the results back into the self-learning loop (outcomes + discoveries) so the
 * grader's weights and the published corpus compound over time.
 */
export async function runSynthesis(): Promise<SynthesisRunSummary> {
  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const path = await import('node:path');
    const file = path.join(process.cwd(), 'data', 'research-accumulation.json');
    let cumulative = { studies: [], simulations: [], crossReferences: [] };
    if (existsSync(file)) cumulative = JSON.parse(readFileSync(file, 'utf-8'));

    const res = await fetch(`${ONCOLOGY_SYNTHESIS_URL}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cumulative }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`synthesis route http_${res.status}`);

    const data = await res.json();
    const synthesized: string[] = data.synthesized ?? [];
    const breakthroughs = data.breakthroughCandidates ?? [];

    // Feedback path 1 + 2: record an outcome and upsert each breakthrough as a
    // discovery so self-learning + publication loops pick them up.
    await addOutcome({
      agentId: 'synthesis:engine',
      kind: 'job',
      summary: 'Synthesis engine run',
      success: true,
      detail: `synthesized=${synthesized.length} sectors, ${breakthroughs.length} breakthroughs`,
    });
    for (const b of breakthroughs.slice(0, 10)) {
      await upsertDiscovery({
        goalId: `synthesis-${b.sector}-${b.id}`,
        domain: 'oncology',
        area: String(b.sector ?? 'oncology'),
        title: `Synthesis breakthrough: ${b.id}`,
        score: b.score,
        evidenceTier: 'E2',
        breakthroughClass: b.score >= 75 ? 'frontier' : 'promising',
        trend: 'synthesis',
        gradedAt: new Date().toISOString(),
      });
    }

    // Bridge path: push the strongest insights into the BioComposable registry so
    // research depth reaches the variant-surveillance surface. Fire-and-forget and
    // fail-soft — a bridge outage must never break the synthesis cron.
    for (const b of breakthroughs.slice(0, 5)) {
      try {
        await fetch(`${BIOCOMPOSABLE_URL}/api/v1/synthesis/insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sector: b.sector ?? 'oncology',
            insight: b.id,
            outlook: (data.outlooks ?? {})[b.sector]?.status ?? null,
            breakthrough: b.score,
            thresholds: data.thresholds ?? null,
            runId: data.runId ?? null,
            generatedAt: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        // Non-fatal: bridge unreachable.
      }
    }

    return {
      ok: true,
      synthesized,
      outlookCount: Object.keys(data.outlooks ?? {}).length,
      breakthroughCount: breakthroughs.length,
      thresholdsChanged: Boolean(data.thresholds),
    };
  } catch (err) {
    // Fail-soft: never throw the Draymond cron because synthesis is unreachable.
    return { ok: false, synthesized: [], outlookCount: 0, breakthroughCount: 0, thresholdsChanged: false, error: err instanceof Error ? err.message : String(err) };
  }
}
