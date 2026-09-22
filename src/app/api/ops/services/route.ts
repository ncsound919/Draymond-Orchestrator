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
import {
  decideSystemOne,
  bringUpChoiceAdvisory,
  buildBringUpChoiceAdvisory,
  serviceLifecycleAdvisory,
  buildServiceLifecycleAdvisory,
} from '@/lib/draymond/jevClient';

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
      const action = body.action ?? 'start';
      const result =
        action === 'stop'
          ? await stopService(slug)
          : action === 'restart'
            ? await restartService(slug)
            : await startService(slug);
      // Jev advisory (non-authoritative): should this lifecycle action proceed?
      const { state, questions } = serviceLifecycleAdvisory(
        { slug: result.slug, name: result.name, port: null, health: result.up ? 'up' : 'down' },
        action,
      );
      const jev = buildServiceLifecycleAdvisory(await decideSystemOne({ state, questions }));
      return NextResponse.json({ ok: result.up, slug: result.slug, service: result, action, jev });
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
      // Jev advisory (non-authoritative): which down service to bring up first.
      let jev;
      if (down.length > 0) {
        const { state, questions } = bringUpChoiceAdvisory(
          all.filter((s) => !s.up).map((s) => ({ slug: s.slug, name: s.name, port: null, health: 'down' })),
        );
        jev = buildBringUpChoiceAdvisory(await decideSystemOne({ state, questions }));
      }
      return NextResponse.json({ checked: all.length, up: all.filter((s) => s.up).length, down, started, jev });
    }
    return NextResponse.json({ checked: all.length, up: all.filter((s) => s.up).length, down });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
