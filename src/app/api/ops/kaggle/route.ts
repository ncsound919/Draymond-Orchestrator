import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { kaggleStatus, kaggleSearchDatasets, kaggleCompetitions, isKaggleConfigured } from '@/lib/draymond/data-apis';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// The real Kaggle surface (research feed / download / files / snapshots) is
// implemented by the deterministic brain's REST routes (/kaggle/* on :3210).
// This route is the CRON_SECRET-protected proxy the entity invoker calls, so it
// must FORWARD those actions to the brain — not silently treat every POST as a
// dataset search. (Previously research_feed/download/files all hit the search
// handler and 400'd "query is required", so research-data-pipeline never ran.)
// ---------------------------------------------------------------------------

function brainBase(): string {
  return (process.env.BRAIN_URL || 'http://localhost:3210').replace(/\/+$/, '');
}

function brainHeaders(): Record<string, string> {
  const key = process.env.BRAIN_API_KEY;
  return key ? { 'X-API-Key': key } : {};
}

async function callBrain(
  pathWithQuery: string,
  method: 'GET' | 'POST',
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(`${brainBase()}${pathWithQuery}`, {
      method,
      headers: brainHeaders(),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 2000) }; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 503, data: { error: err instanceof Error ? err.message : 'brain unreachable' } };
  }
}

function q(params: Record<string, unknown>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    s.set(k, Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : JSON.stringify(v));
  }
  const qs = s.toString();
  return qs ? `?${qs}` : '';
}

/** GET /api/ops/kaggle — credential status, competitions, plus brain snapshots/feeds. */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const [status, competitions, snapshots, feeds] = await Promise.all([
      kaggleStatus(),
      kaggleCompetitions().catch(() => ({ ok: false as const, detail: 'competitions probe failed' })),
      callBrain('/kaggle/snapshots', 'GET'),
      callBrain('/kaggle/research/feeds', 'GET'),
    ]);
    return NextResponse.json({
      configured: isKaggleConfigured(),
      status,
      competitions,
      snapshots: snapshots.data,
      feeds: feeds.data,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/**
 * POST /api/ops/kaggle — invoker envelope `{ action, ...payload }`.
 * Forwards research_feed/download/files to the brain; dataset search can be
 * served locally (kaggleSearchDatasets) as a fallback.
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      query?: string;
      dataset?: string;
      ref?: string;
      tags?: string | string[];
      force?: boolean;
      unzip?: boolean;
      index_tfidf?: boolean;
    };
    const action = (body.action ?? '').trim();

    if (action === 'research_feed') {
      const r = await callBrain(
        `/kaggle/research/feed${q({ dataset: body.dataset, tags: body.tags, force: body.force, index_tfidf: body.index_tfidf })}`,
        'POST',
      );
      return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
    }

    if (action === 'download') {
      const r = await callBrain(
        `/kaggle/datasets/download${q({ dataset: body.dataset, force: body.force, unzip: body.unzip })}`,
        'POST',
      );
      return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
    }

    if (action === 'files') {
      const r = await callBrain(`/kaggle/datasets/files${q({ ref: body.ref ?? body.dataset })}`, 'GET');
      return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
    }

    // Dataset search (explicit action, or a bare `query`). Local first.
    const query = (body.query ?? body.dataset ?? '').trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    const result = await kaggleSearchDatasets(query);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
