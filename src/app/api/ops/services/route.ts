import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';
import {
  probeAllServices,
  startDownServices,
  startService,
  stopService,
  stopServices,
  restartService,
  serviceCatalog,
} from '@/lib/draymond/service-manager';

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

/** POST /api/ops/services — start, stop (close), or restart services */
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      start?: boolean;
      action?: 'start' | 'restart' | 'stop';
      slug?: string;
      slugs?: string[];
    };

    if (typeof body.slug === 'string' && body.slug.trim()) {
      const slug = body.slug.trim();
      const result =
        body.action === 'stop'
          ? await stopService(slug)
          : body.action === 'restart'
            ? await restartService(slug)
            : await startService(slug);
      return NextResponse.json({ ok: result.up, slug: result.slug, service: result, action: body.action ?? 'start' });
    }

    if (Array.isArray(body.slugs) && body.slugs.length > 0) {
      if (body.action === 'stop') {
        const stopped = await stopServices(body.slugs.filter(Boolean));
        return NextResponse.json({ checked: body.slugs.length, up: stopped.filter((s) => s.up).length, stopped });
      }
      const started = await startDownServices(body.slugs.filter(Boolean));
      return NextResponse.json({ checked: body.slugs.length, up: started.filter((s) => s.up).length, started });
    }

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
