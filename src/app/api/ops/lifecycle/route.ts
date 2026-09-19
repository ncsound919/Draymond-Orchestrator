import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  sectorState,
  ensureServiceForTask,
  stopService,
  sectorSweep,
  touchService,
  lifecycleEnabled,
  WARM_SERVICES,
} from '@/lib/draymond/sector-lifecycle';

export const dynamic = 'force-dynamic';

/** GET /api/ops/lifecycle — the CPU-friendly sector lifecycle snapshot */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    lifecycle: sectorState(),
    enabled: lifecycleEnabled(),
    warm: [...WARM_SERVICES].sort(),
  });
}

/**
 * POST /api/ops/lifecycle — manual operator actions (never automatic):
 *   { action: 'ensure', slug }  — cold-start a managed service for a task
 *   { action: 'stop',   slug }  — stop a managed on-demand service (warm protected)
 *   { action: 'sweep' }         — run the idle sweep now
 *   { action: 'touch',  slug }  — mark a service as just-used (reset idle clock)
 */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as { action?: string; slug?: string };
  const { action, slug } = body;

  if (action === 'ensure' && slug) {
    const result = await ensureServiceForTask(slug);
    return NextResponse.json({ slug, result, lifecycle: sectorState() });
  }

  if (action === 'stop' && slug) {
    const result = await stopService(slug);
    return NextResponse.json({ slug, result, lifecycle: sectorState() });
  }

  if (action === 'sweep') {
    const result = await sectorSweep();
    return NextResponse.json({ ...result, lifecycle: sectorState() });
  }

  if (action === 'touch' && slug) {
    touchService(slug);
    return NextResponse.json({ slug, touched: true, lifecycle: sectorState() });
  }

  return NextResponse.json(
    { error: 'send { action: "ensure"|"stop"|"sweep"|"touch", slug? }' },
    { status: 400 }
  );
}
