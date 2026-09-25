import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/marketing-team
 * Returns the marketing team roster, gathered marketing skills, and the
 * Dev-Brain marketing leader genomes. Pass ?probe=1 to also health-check the
 * team's live services (bounded ~3s). Pass ?formation=1 to include the
 * operative formation (cells, chain of command, rhythm, rules) + its markdown.
 *
 * POST /api/ops/marketing-team
 * Body: { problem?, channels?, campaigns?, proposals?, strategy? }
 * Runs one marketing strategy pass: Dev-Brain /api/marketing/decide for the
 * channel mix, then the strategy team (Dev-Brain /api/strategy/decide) to rank
 * the candidate strategy bets.
 *
 * Auth: Bearer CRON_SECRET. Deterministic (no LLM) via Dev-Brain.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  try {
    const params = req.nextUrl.searchParams;
    const probe = ['1', 'true'].includes((params.get('probe') ?? '').toLowerCase());
    const wantFormation = ['1', 'true'].includes((params.get('formation') ?? '').toLowerCase());
    const { marketingTeamStatus, marketingTeamSlugs } = await import('@/lib/draymond/marketing-team');
    const status = await marketingTeamStatus({ probe });

    let formation: Record<string, unknown> | undefined;
    if (wantFormation) {
      const { marketingFormation, marketingFormationMarkdown, validateMarketingFormation } = await import(
        '@/lib/draymond/marketing-formation'
      );
      formation = {
        ...marketingFormation(),
        validation: validateMarketingFormation(),
        markdown: marketingFormationMarkdown(),
      };
    }

    return NextResponse.json({ ok: true, ...status, slugs: marketingTeamSlugs(), formation });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = authorizeRequest(req);
  if (auth) return auth;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  try {
    const { runMarketingStrategy } = await import('@/lib/draymond/marketing-team');
    const strategy = await runMarketingStrategy({
      problem: body.problem as string | undefined,
      channels: body.channels as never,
      campaigns: body.campaigns as never,
      proposals: body.proposals as never,
      strategyKey: body.strategy as never,
    });
    return NextResponse.json({ ok: true, ...strategy });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
