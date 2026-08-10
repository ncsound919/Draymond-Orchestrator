import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import {
  enqueueExperiment,
  listExperiments,
  nextExperiment,
  researchRotation,
} from '@/lib/science/experiments';

export const dynamic = 'force-dynamic';

/**
 * Science experiments.
 *   GET  /api/v1/science/experiments             → all experiments
 *   GET  /api/v1/science/experiments?goal_id=x   → filter by goal
 *   POST /api/v1/science/experiments             → { mode: 'run' } body = ExperimentSpec (enqueue + run)
 *   POST /api/v1/science/experiments             → { mode: 'next' } drain highest-priority
 *   POST /api/v1/science/experiments             → { mode: 'rotation' } research rotation hook
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const goalId = request.nextUrl?.searchParams.get('goal_id') ?? undefined;
  try {
    const experiments = await listExperiments(goalId ? { goal_id: goalId } : {});
    return NextResponse.json({ ok: true, experiments });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    mode?: 'run' | 'next' | 'rotation';
    spec?: Record<string, unknown>;
    goal_id?: string;
    hypothesis_id?: string;
    domain?: 'sports' | 'biotech';
    type?: 'analysis' | 'simulation' | 'translation';
    model_id?: string;
    inputs?: Record<string, unknown>;
  }>(request);
  if (parseError) return parseError;

  try {
    const mode = body?.mode ?? 'run';
    if (mode === 'next') {
      const spec = await nextExperiment();
      return NextResponse.json({ ok: true, next: spec });
    }
    if (mode === 'rotation') {
      const result = await researchRotation();
      return NextResponse.json({ ok: true, ...result });
    }
    // run: enqueue + execute immediately
    const spec = {
      goal_id: body?.goal_id ?? '',
      hypothesis_id: body?.hypothesis_id,
      domain: body?.domain ?? 'sports',
      type: body?.type ?? 'simulation',
      model_id: body?.model_id,
      inputs: body?.inputs ?? {},
    };
    if (!spec.goal_id || !spec.model_id) {
      return NextResponse.json({ ok: false, error: 'goal_id and model_id required' }, { status: 400 });
    }
    const queued = await enqueueExperiment(spec);
    const { runExperiment } = await import('@/lib/science/experiments');
    const result = await runExperiment(queued);
    return NextResponse.json({ ok: true, experiment: result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
