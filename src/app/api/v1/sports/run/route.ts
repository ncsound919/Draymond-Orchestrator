import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { submitExperiment } from '@/lib/sports/api';
import type { Task } from '@/lib/sports/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    sport?: string;
    goal?: string;
    tasks?: Task[];
  }>(request);
  if (parseError) return parseError;

  const { sport, goal, tasks } = body ?? {};
  if (!sport || !goal || !Array.isArray(tasks)) {
    return NextResponse.json({ ok: false, error: 'sport, goal and tasks required' }, { status: 400 });
  }
  try {
    const res = await submitExperiment({ sport, goal, tasks });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
