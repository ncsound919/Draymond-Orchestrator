// ============================================================================
// /api/v1/benchmarks — ingest benchmark/skill-test runs into draymond_benchmarks
// ============================================================================
// The Open-Chat on-device harness (model latency, skill tests, verification)
// POSTs its runs here so they become part of Draymond's self-learning loop.
// Protected by CRON_SECRET Bearer token.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { createDraymondAdminClient } from '@/lib/draymond/client';

export const dynamic = 'force-dynamic';

const VALID_CLASSES = new Set(['entity', 'site', 'cron', 'chain']);

type BenchRow = {
  run_id: string;
  component_class: string;
  component_slug: string;
  component_name: string;
  metrics: Record<string, unknown>;
  weakness_score?: number;
  trend?: Record<string, unknown>;
  evidence?: string | null;
};

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{ rows: BenchRow[] }>(request);
  if (parseError) return parseError;

  try {
    const rows = (body.rows ?? []).filter(
      (r) =>
        r &&
        typeof r.run_id === 'string' &&
        VALID_CLASSES.has(r.component_class) &&
        typeof r.component_slug === 'string'
    );
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'no valid benchmark rows' }, { status: 400 });
    }

    const supabase = createDraymondAdminClient();
    const { data: inserted, error } = await supabase
      .from('draymond_benchmarks')
      .insert(
        rows.map((r) => ({
          run_id: r.run_id,
          component_class: r.component_class,
          component_slug: r.component_slug,
          component_name: r.component_name ?? r.component_slug,
          metrics: r.metrics ?? {},
          weakness_score: r.weakness_score ?? 0,
          trend: r.trend ?? {},
          evidence: r.evidence ?? null,
        }))
      )
      .select('id');

    if (error) throw error;

    return NextResponse.json({ ok: true, count: inserted?.length ?? rows.length });
  } catch (err) {
    console.error('[API /api/v1/benchmarks POST]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
