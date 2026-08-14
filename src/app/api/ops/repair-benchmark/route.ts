// /api/ops/repair-benchmark — dispatch the Draymond repair team on weak
// benchmark components pushed by Benchmark Olympics' discovery loop (auto-fix).
//
// Auth: CRON_SECRET Bearer token (same as /api/v1/benchmarks).
//
// Body (JSON):
//   { rows: [ { component_slug, component_name, weakness_score, reasons[],
//               proposed_action?, repo_url? } ] }
//
// Guardrails: rows are validated + capped (5/request); each component is
// cooldown-gated and only score >= 50 is dispatched. Kill switch:
// DRAYMOND_REPAIR_BENCHMARK_ENABLED=0 → proposal-only (handed-off) records.
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    rows?: Array<{
      component_slug?: unknown;
      component_name?: unknown;
      weakness_score?: unknown;
      reasons?: unknown;
      proposed_action?: unknown;
      repo_url?: unknown;
    }>;
  }>(request);
  if (parseError) return parseError;

  try {
    const { repairWeakEntity } = await import('@/lib/draymond/repair-team');
    const rows = (body.rows ?? [])
      .filter(
        (r) =>
          r &&
          typeof r.component_slug === 'string' &&
          r.component_slug.trim().length > 0 &&
          typeof r.weakness_score === 'number' &&
          Number.isFinite(r.weakness_score) &&
          r.weakness_score >= 0
      )
      .slice(0, 5)
      .map((r) => ({
        component_slug: r.component_slug as string,
        component_name: typeof r.component_name === 'string' ? r.component_name : (r.component_slug as string),
        weakness_score: r.weakness_score as number,
        reasons: Array.isArray(r.reasons) ? (r.reasons as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
        proposed_action: typeof r.proposed_action === 'string' ? r.proposed_action : undefined,
        repo_url: typeof r.repo_url === 'string' ? r.repo_url : null,
      }));

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, dispatched: 0, error: 'no valid benchmark weakness rows' }, { status: 400 });
    }

    const results = [];
    for (const row of rows) {
      try {
        const report = await repairWeakEntity(row);
        results.push({
          component_slug: row.component_slug,
          component_name: row.component_name,
          weakness_score: row.weakness_score,
          ok: report.action === 'fixed',
          action: report.action,
          detail: report.detail,
        });
      } catch (err) {
        results.push({
          component_slug: row.component_slug,
          component_name: row.component_name,
          weakness_score: row.weakness_score,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dispatched = results.length;
    return NextResponse.json({ ok: true, dispatched, results });
  } catch (err) {
    console.error('[API /api/ops/repair-benchmark]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, dispatched: 0, error: 'Repair dispatch failed' }, { status: 500 });
  }
}
