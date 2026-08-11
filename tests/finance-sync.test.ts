import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFinanceBrief, syncFinanceGoals } from '../src/lib/draymond/finance-sync';

const BASE = 'http://localhost:4000';
process.env.FINANCE_CONNECT_URL = BASE;
process.env.FINANCE_CONNECT_TOKEN = 'secret';

const brief = {
  ok: true,
  data: { date: '2026-08-11', status: 'complete', recommendations: [{ id: 'rec-001', action: 'x', citation: 'AI Hustles, p.88' }] },
};

beforeEach(() => {
  process.env.FINANCE_CONNECT_URL = BASE;
  process.env.FINANCE_CONNECT_TOKEN = 'secret';
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === `${BASE}/api/v1/strategy/daily`) {
      return new Response(JSON.stringify(brief), { status: 200 });
    }
    if (url === `${BASE}/api/v1/goals`) {
      return new Response(
        JSON.stringify({ ok: true, data: { goals: [{ id: 'daily-strategy', title: 'Run the book-grounded daily strategy brief', progressPct: 0, status: 'active', capability: 'strategy-daily' }] } }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FINANCE_CONNECT_URL;
  delete process.env.FINANCE_CONNECT_TOKEN;
});

describe('finance-sync', () => {
  it('fetches the daily strategy brief', async () => {
    const res = await fetchFinanceBrief();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.brief?.status).toBe('complete');
  });

  it('is fail-soft when finance-connect is not configured', async () => {
    delete process.env.FINANCE_CONNECT_URL;
    const res = await fetchFinanceBrief();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });

  it('returns ok:false when the backend has no strategy brief yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === `${BASE}/api/v1/strategy/daily`) {
        return new Response(JSON.stringify({ ok: true, data: null }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
    const res = await fetchFinanceBrief();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no strategy brief/i);
  });

  it('lists remote goals and creates a new goal when none exists', async () => {
    const res = await syncFinanceGoals({
      createGoal: async () => 'goal-id',
      updateGoalProgress: async () => {},
      findGoal: async () => null,
    });
    expect(res).toHaveLength(1);
    expect(res[0].ok).toBe(true);
  });

  it('upserts: updates the existing goal instead of creating a duplicate', async () => {
    const createGoal = vi.fn(async () => 'fresh-id');
    const updateGoalProgress = vi.fn(async () => {});
    const findGoal = vi.fn(async () => ({ id: 'existing-goal-1' }));
    const res = await syncFinanceGoals({ createGoal, updateGoalProgress, findGoal });
    expect(createGoal).not.toHaveBeenCalled();
    expect(updateGoalProgress).toHaveBeenCalledWith('existing-goal-1', 0);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ ok: true, goalId: 'existing-goal-1', updated: true });
  });

  it('creates a goal when no match exists, then records progress', async () => {
    const createGoal = vi.fn(async () => 'goal-id');
    const updateGoalProgress = vi.fn(async () => {});
    const findGoal = vi.fn(async () => null);
    const res = await syncFinanceGoals({ createGoal, updateGoalProgress, findGoal });
    expect(createGoal).toHaveBeenCalledTimes(1);
    expect(createGoal).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: 'overlay-treasurer', title: 'Run the book-grounded daily strategy brief', horizon: 'medium_term', priority: 60 })
    );
    expect(updateGoalProgress).toHaveBeenCalledWith('goal-id', 0);
    expect(res[0]).toMatchObject({ ok: true, goalId: 'goal-id', updated: false });
  });
});
