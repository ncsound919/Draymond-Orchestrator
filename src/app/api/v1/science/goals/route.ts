import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody, sanitizeError } from '@/lib/draymond/api-auth';
import { listGoals, getGoal, listHypotheses, updateGoalStatus } from '@/lib/science/goals';
import { scoreGoal } from '@/lib/science/priority';

export const dynamic = 'force-dynamic';

/**
 * System goals + hypotheses.
 *   GET /api/v1/science/goals            → all goals with scored priorities
 *   GET /api/v1/science/goals?goal_id=x  → one goal + its hypotheses
 *   POST /api/v1/science/goals           → { goal_id, status } update
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const goalId = request.nextUrl?.searchParams.get('goal_id') ?? null;
  try {
    if (goalId) {
      const goal = await getGoal(goalId);
      if (!goal) return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
      const hypotheses = await listHypotheses(goalId);
      const scored = scoreGoal(goal, hypotheses);
      return NextResponse.json({ ok: true, goal: { ...goal, priority: scored.score, maturity: scored.maturity }, hypotheses });
    }
    const goals = await listGoals();
    const allHyps = await listHypotheses();
    const scoredGoals = goals.map((g) => {
      const hyps = (g.hypothesis_ids ?? [])
        .map((id) => allHyps.find((h) => h.id === id))
        .filter(Boolean) as typeof allHyps;
      const scored = scoreGoal(g, hyps);
      return { ...g, priority: scored.score, maturity: scored.maturity };
    });
    scoredGoals.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return NextResponse.json({ ok: true, goals: scoredGoals });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    goal_id?: string;
    status?: string;
  }>(request);
  if (parseError) return parseError;

  const { goal_id, status } = body ?? {};
  if (!goal_id || !status) {
    return NextResponse.json({ ok: false, error: 'goal_id and status required' }, { status: 400 });
  }
  try {
    const goal = await updateGoalStatus(goal_id, status as 'active' | 'paused' | 'completed' | 'archived');
    if (!goal) return NextResponse.json({ ok: false, error: 'goal not found' }, { status: 404 });
    return NextResponse.json({ ok: true, goal });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
