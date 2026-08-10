import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { submitExperiment } from '@/lib/biotech/api';
import type { Task } from '@/lib/biotech/types';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    cancer_type?: string;
    goal?: string;
    tasks?: Task[];
  }>(request);
  if (parseError) return parseError;

  const { cancer_type, goal, tasks } = body ?? {};
  if (!cancer_type || !goal || !Array.isArray(tasks)) {
    return NextResponse.json({ ok: false, error: 'cancer_type, goal and tasks required' }, { status: 400 });
  }
  try {
    const res = await submitExperiment({ cancer_type, goal, tasks });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 400 });
  }
}
