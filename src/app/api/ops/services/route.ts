import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import { probeAllServices, startDownServices, serviceCatalog } from '@/lib/draymond/service-manager';

export const dynamic = 'force-dynamic';

/** GET /api/ops/services — catalog + live health of every ecosystem service */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const [catalog, health] = await Promise.all([serviceCatalog(), probeAllServices()]);
    return NextResponse.json({ catalog, health });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

/** POST /api/ops/services — probe and auto-start down services */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as { start?: boolean };
    const all = await probeAllServices();
    const down = all.filter((s) => !s.up).map((s) => s.slug);
    if (body.start !== false) {
      const started = await startDownServices(down.slice(0, 5));
      return NextResponse.json({ checked: all.length, up: all.filter((s) => s.up).length, down, started });
    }
    return NextResponse.json({ checked: all.length, up: all.filter((s) => s.up).length, down });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
