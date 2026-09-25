import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/release-team
 * Returns the release crew (software factory) formation: cells, chain of
 * command, cadence, duty, basis, toolchain availability, rhythm, rules, plus
 * a validation object and rendered markdown.
 *
 * Query:
 *   ?formation=1  include the full formation + validation + markdown (default: on)
 *   ?probe=1      health-check every crew member that has a registered port (bounded)
 *
 * Auth: Bearer CRON_SECRET. Read-only; deterministic; never starts a service.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  try {
    const params = req.nextUrl.searchParams;
    const probe = ['1', 'true'].includes((params.get('probe') ?? '').toLowerCase());
    const wantFormation = !['0', 'false'].includes((params.get('formation') ?? '1').toLowerCase());

    const { releaseFormation, releaseFormationMarkdown, validateReleaseFormation, releaseCrewSummary } =
      await import('@/lib/draymond/release-formation');

    const formation = releaseFormation();
    const validation = validateReleaseFormation();

    let probes: Array<{ slug: string; name: string; up: boolean; detail: string; port: number | null }> | null = null;
    if (probe) {
      const { probeService } = await import('@/lib/draymond/service-manager');
      probes = await Promise.all(
        formation.positions
          .filter((p) => typeof p.port === 'number' && p.available !== false)
          .map(async (p) => {
            const result = await probeService(p.slug, 3000);
            return { slug: p.slug, name: p.name, up: result.up, detail: result.detail, port: p.port ?? null };
          })
      );
    }

    return NextResponse.json({
      ok: true,
      summary: releaseCrewSummary(),
      positions: wantFormation ? formation.positions : undefined,
      cells: wantFormation ? formation.cells : undefined,
      rhythm: wantFormation ? formation.rhythm : undefined,
      rules: wantFormation ? formation.rules : undefined,
      markdown: wantFormation ? releaseFormationMarkdown() : undefined,
      validation,
      probes,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
