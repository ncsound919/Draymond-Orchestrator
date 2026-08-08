import { NextRequest, NextResponse } from 'next/server';
import { requireMathAuth, readJson, mathErrorResponse } from '@/lib/mathx/route-helpers';
import { generateMathCode } from '@/lib/mathx/services';

export const dynamic = 'force-dynamic';

/** POST /api/math/codegen — generate Python compute code for a task. */
export async function POST(request: NextRequest) {
  const auth = await requireMathAuth();
  if (auth.error) return auth.error;

  const parsed = await readJson<{ task?: string; mode?: string; context?: string; domain?: string }>(request);
  if (parsed.error) return parsed.error;
  const { task, mode, context, domain } = parsed.data;

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    return NextResponse.json({ error: 'task is required' }, { status: 400 });
  }
  try {
    const code = await generateMathCode(task.trim(), mode ?? 'scientist', context, domain);
    return NextResponse.json({ code });
  } catch (err) {
    return mathErrorResponse(err);
  }
}
