import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { extractLatex } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/ocr — image (base64) → LaTeX via a vision-capable provider.
 *  Contract: { data, mediaType } — the canonical math-x shape. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ data?: string; mediaType?: string }>(request, 8 * 1024 * 1024);
  if (parsed.error) return parsed.error;
  const { data, mediaType } = parsed.data;

  if (!data || typeof data !== 'string' || data.length === 0) {
    return NextResponse.json({ error: 'data (base64 image) is required' }, { status: 400 });
  }
  if (!mediaType || typeof mediaType !== 'string') {
    return NextResponse.json({ error: 'mediaType is required' }, { status: 400 });
  }
  try {
    const result = await extractLatex(data, mediaType);
    return NextResponse.json(result);
  } catch (err) {
    return mathErrorResponse(err);
  }
}
