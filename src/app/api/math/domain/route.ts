import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { runDomainExpert } from '@/lib/mathx/services';
import { DOMAIN_SYSTEM_PROMPTS } from '@/lib/mathx/domainPrompts';

export const dynamic = 'force-dynamic';

/** POST /api/math/domain — domain-expert answer (proof or persona). */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ domain?: string; query?: string; isProofRequest?: boolean }>(request);
  if (parsed.error) return parsed.error;
  const { domain, query, isProofRequest } = parsed.data;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 });
  }
  if (!domain || !DOMAIN_SYSTEM_PROMPTS[domain]) {
    return NextResponse.json(
      { error: `domain must be one of: ${Object.keys(DOMAIN_SYSTEM_PROMPTS).join(', ')}` },
      { status: 400 },
    );
  }
  try {
    const result = await runDomainExpert(domain, query.trim(), Boolean(isProofRequest));
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
