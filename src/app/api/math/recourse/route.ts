import { NextResponse } from 'next/server';
import { requireMathAuth, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { recourseStatus, recourseMathState, recourseAdvanceTick } from '@/lib/mathx/recourse';

export const dynamic = 'force-dynamic';

/** GET /api/math/recourse — Recourse engine status + recursive-math loop state. */
export async function GET() {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  try {
    const [status, math] = await Promise.all([recourseStatus(), recourseMathState()]);
    return NextResponse.json({
      available: status.available,
      error: status.error ?? null,
      status: status.data?.status ?? null,
      chainIntegrity: status.data?.chainIntegrity ?? null,
      recursiveMath: math.data?.state ?? null,
    });
  } catch (err) {
    return mathErrorResponse(err);
  }
}

/** POST /api/math/recourse/tick — the fleet actively advances Recourse's
 *  autonomous self-developer (a real execute call, not a status read). */
export async function POST() {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  try {
    const r = await recourseAdvanceTick();
    return NextResponse.json({
      available: r.available,
      error: r.error ?? null,
      advanced: r.available === true,
      success: r.data?.success ?? null,
      systemGeneration: r.data?.systemStatus?.generation ?? null,
      capabilityServed: r.data?.capabilityServed ?? null,
    });
  } catch (err) {
    return mathErrorResponse(err);
  }
}
