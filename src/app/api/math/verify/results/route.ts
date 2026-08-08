import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson } from '@/lib/mathx/route-helpers';
import { mergeVerifyResults } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/verify/results — merge SymPy verdicts onto steps + trust score. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{
    steps?: Array<{
      step: number;
      description?: string;
      from_expr?: string;
      to_expr?: string;
      operation?: string;
      verifiable: boolean;
    }>;
    sympyResults?: Array<{ step: number; verified: boolean; method: string; error?: string }>;
  }>(request);
  if (parsed.error) return parsed.error;

  const { steps, sympyResults } = parsed.data;
  if (!Array.isArray(steps) || !Array.isArray(sympyResults)) {
    return NextResponse.json(
      { error: 'steps and sympyResults arrays are required' },
      { status: 400 },
    );
  }
  try {
    const result = mergeVerifyResults(
      steps.map((s) => ({
        step: s.step,
        description: s.description ?? '',
        from_expr: s.from_expr ?? '',
        to_expr: s.to_expr ?? '',
        operation: s.operation ?? 'algebra',
        verifiable: Boolean(s.verifiable),
      })),
      sympyResults.map((r) => ({ step: r.step, verified: r.verified, method: r.method, error: r.error })),
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Failed to merge verification results' }, { status: 500 });
  }
}
