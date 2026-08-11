// Fail-soft integration with finance-connect: pulls the DailyStrategyBrief and
// syncs capability-grounded goals into draymond_goals. Never throws.

export interface FinanceBriefResult {
  ok: boolean;
  brief?: { date: string; status: string; recommendations: Array<{ id: string; action: string; citation: string }>; ungroundedTopics: string[] };
  error?: string;
}

type Horizon = 'immediate' | 'short_term' | 'medium_term' | 'long_term';

interface GoalInput {
  id: string;
  horizon: string;
  capability: string;
  title: string;
  progressPct: number;
  status: string;
}

function connectUrl(): string | undefined {
  return process.env.FINANCE_CONNECT_URL;
}

async function authed(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const base = connectUrl();
  if (!base) return { ok: false, error: 'finance-connect not configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${process.env.FINANCE_CONNECT_TOKEN ?? ''}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json()) as { ok?: boolean; data?: unknown; error?: string };
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `finance-connect HTTP ${res.status}` };
    }
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchFinanceBrief(): Promise<FinanceBriefResult> {
  const res = await authed('/api/v1/strategy/daily');
  if (!res.ok) return res;
  return { ok: true, brief: res.data as FinanceBriefResult['brief'] };
}

/** Pull goals from finance-connect and upsert into draymond_goals. */
export async function syncFinanceGoals(deps: {
  createGoal: (input: { agent_id: string; title: string; description?: string; horizon?: Horizon; priority?: number }) => Promise<string>;
  updateGoalProgress: (goalId: string, progressPct: number) => Promise<void>;
}): Promise<Array<{ ok: boolean; goalId?: string; error?: string }>> {
  const res = await authed('/api/v1/goals');
  if (!res.ok) return [{ ok: false, error: res.error }];
  const goals = ((res.data as { goals?: GoalInput[] })?.goals ?? []);
  const results: Array<{ ok: boolean; goalId?: string; error?: string }> = [];
  for (const g of goals) {
    try {
      const horizon: Horizon = g.horizon === 'daily' ? 'immediate' : g.horizon === 'weekly' ? 'short_term' : 'medium_term';
      const goalId = await deps.createGoal({
        agent_id: 'overlay-treasurer',
        title: g.title,
        description: `Capability: ${g.capability} (synced from finance-connect)`,
        horizon,
        priority: 60,
      });
      await deps.updateGoalProgress(goalId, g.progressPct);
      results.push({ ok: true, goalId });
    } catch (err) {
      results.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
