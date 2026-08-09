import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { listUltraplans, enqueueUltraplan } from '@/lib/draymond/ultraplan';
import type { UltraplanStatus } from '@/lib/draymond/ultraplan';

export const dynamic = 'force-dynamic';

const STATUSES: UltraplanStatus[] = ['queued', 'planning', 'plan_ready', 'approved', 'rejected', 'failed'];

/** GET /api/cognition/ultraplan?status= — plan queue */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const statusRaw = request.nextUrl.searchParams.get('status');
  const status = statusRaw && STATUSES.includes(statusRaw as UltraplanStatus) ? (statusRaw as UltraplanStatus) : undefined;
  const plans = await listUltraplans(status ? { status } : {});
  return NextResponse.json({ plans });
}

/** POST /api/cognition/ultraplan { title, brief, scope?, sources? } — enqueue */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === 'string' ? body.title : '';
  const brief = typeof body.brief === 'string' ? body.brief : '';
  if (!title || !brief) {
    return NextResponse.json({ error: 'title and brief are required' }, { status: 400 });
  }
  try {
    const plan = await enqueueUltraplan({
      title,
      brief,
      scope: typeof body.scope === 'string' ? body.scope : undefined,
      sources: Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === 'string') : undefined,
    });
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'enqueue failed' },
      { status: 409 }
    );
  }
}
