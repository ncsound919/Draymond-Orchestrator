import { describe, expect, it, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyFailure, assembleCrew, leastAttempted, leadAttemptsFromLog, leadStatsFromLog, bestLeadFromStats, repairFailedJob, repairWeakEntity, renderRepairReport, type RepairReport } from '../src/lib/draymond/repair-team';

// Hermetic env: repairFailedJob → recordRepair + recordOutcome write to the
// file-backed .draymond registry. Without this temp dir, the test fixtures
// (j1–j4, "X" job) pollute the REAL repair-team-log.json + learning-outcomes.json
// and poison the self-learning lessons. See tests/metrics.test.ts for the pattern.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-repair-team-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

// The codegen dispatch path must never hit a real opencode/uplift process in
// tests — stub it to a fast, fixed outcome.
vi.mock('../src/lib/draymond/coding-repair', () => ({
  dispatchCodingRepair: vi.fn(async () => ({
    action: 'handed-off',
    detail: 'coding crew (test mock) proposed a fix',
    dispatch: { kind: 'codegen', engine: 'test-mock', result: 'mock', duration_ms: 1 },
  })),
}));

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('repair team', () => {
  it('classifies chain config failures', () => {
    expect(classifyFailure('chain job missing job_config.chain_slug')).toBe('chain_config');
  });

  it('classifies notification config failures', () => {
    expect(classifyFailure('notification job missing required job_config.payload (recipient, subject, body)')).toBe('notification_config');
  });

  it('assembles a coding crew for config failures', () => {
    const crew = assembleCrew('chain_config');
    expect(crew.lead).toBe('opencode');
    expect(crew.members).toContain('megacode');
    expect(crew.members).toContain('big-homie');
    expect(crew.members).toContain('reporank');
  });

  it('fixes a chain job by rewriting chain -> chain_slug', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j1', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.chain_slug).toBe('marketing-pulse');
    expect(updates[0]!).not.toHaveProperty('chain');
  });

  it('fixes a notification job by wrapping type into payload', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const report = await repairFailedJob(
      { id: 'j2', name: 'Daily Health Digest', job_type: 'notification', job_config: { type: 'health_summary' } },
      'notification job missing required job_config.payload',
      { updateJobConfig: async (id, config) => { updates.push(config); } },
    );
    expect(report.action).toBe('fixed');
    expect(updates[0]!.payload).toEqual({ type: 'health_summary' });
  });

  it('escalates missing-env failures to the crew lead', async () => {
    const report = await repairFailedJob(
      { id: 'j3', name: 'X', job_type: 'custom', job_config: {} },
      'NEWSAPI_KEY not configured',
      { updateJobConfig: async () => {} },
    );
    expect(report.action).toBe('escalated');
    expect(report.failureKind).toBe('missing_env');
  });

  it('carries distilled lesson hints into the repair report', async () => {
    const report = await repairFailedJob(
      { id: 'j4', name: 'Evening Marketing Prep', job_type: 'chain', job_config: { chain: 'marketing-pulse' } },
      'chain job missing job_config.chain_slug',
      { updateJobConfig: async () => {} },
      ['Repeated failure: "Evening Marketing Prep" (3/3).'],
    );
    expect(report.lessonHints).toEqual(['Repeated failure: "Evening Marketing Prep" (3/3).']);
  });

  it('dispatches the coding crew immediately on the FIRST code_error (no evidence needed)', async () => {
    const report = await repairFailedJob(
      { id: 'j5', name: 'Evening Marketing Prep', job_type: 'custom', job_config: {} },
      'Scheduler job threw an error while running',
      { updateJobConfig: async () => {} },
    );
    expect(report.action).toBe('handed-off');
    expect(report.dispatch?.kind).toBe('codegen');
    expect((report.dispatch as { engine?: string }).engine).toBe('test-mock');
  });

  it('defers a repeated code_error while the per-job cooldown is active', async () => {
    const job = { id: 'j6', name: 'Evening Marketing Prep', job_type: 'custom', job_config: {} };
    const first = await repairFailedJob(job, 'Scheduler job threw an error while running', { updateJobConfig: async () => {} });
    expect(first.dispatch?.kind).toBe('codegen');
    const second = await repairFailedJob(job, 'Scheduler job threw an error while running', { updateJobConfig: async () => {} });
    expect(second.action).toBe('handed-off');
    expect(second.dispatch?.kind).toBe('deferred');
  });

  it('renders a deterministic, LLM-free repair report', () => {
    const report: RepairReport = {
      jobId: 'j7',
      jobName: 'Evening Marketing Prep',
      failureKind: 'chain_config',
      error: 'chain job missing job_config.chain_slug',
      crew: { lead: 'opencode', members: ['big-homie', 'reporank'], reason: 'x' },
      action: 'fixed',
      detail: 'rewrote job_config: chain -> chain_slug',
      repairedAt: '2026-08-09T00:00:00.000Z',
      lessonHints: ['Repeated failure (3/3).'],
      dispatch: { kind: 'service_start', result: 'started bookbridge' },
    };
    const text = renderRepairReport(report);
    expect(text).toContain('Draymond Repair Report');
    expect(text).toContain('Evening Marketing Prep');
    expect(text).toContain('Chain config');
    expect(text).toContain('FIXED');
    expect(text).toContain('opencode + big-homie, reporank');
    expect(text).toContain('rewrote job_config: chain -> chain_slug');
  });
});

describe('benchmark weakness repair (Benchmark Olympics wiring)', () => {
  it('hands off monitor-band components without dispatching any engine', async () => {
    const report = await repairWeakEntity({
      component_slug: 'cand-monitor',
      component_name: 'Healthy Candidate',
      weakness_score: 30,
      reasons: ['slight regression'],
      proposed_action: 'Monitor only.',
    });
    expect(report.failureKind).toBe('benchmark_weak');
    expect(report.action).toBe('handed-off');
    expect(report.detail).toContain('monitor only');
    expect(report.dispatch).toBeUndefined();
  });

  it('dispatches the coding crew for a weak component above the remediation band', async () => {
    const report = await repairWeakEntity({
      component_slug: 'cand-weak-1',
      component_name: 'Weak Proxy',
      weakness_score: 82,
      reasons: ['p99 latency exceeded SLA', 'memory growth under load'],
      proposed_action: 'Bump model tier / rotate API profile.',
    });
    expect(report.failureKind).toBe('benchmark_weak');
    expect(report.jobId).toBe('benchmark:cand-weak-1');
    expect(report.dispatch?.kind).toBe('codegen');
    expect((report.dispatch as { engine?: string }).engine).toBe('test-mock');
  });

  it('respects the auto-fix kill switch (proposal-only, no codegen)', async () => {
    process.env.DRAYMOND_REPAIR_BENCHMARK_ENABLED = '0';
    try {
      const report = await repairWeakEntity({
        component_slug: 'cand-weak-2',
        component_name: 'Weak Guard',
        weakness_score: 77,
        reasons: ['security weakness'],
        proposed_action: 'Reconfigure invocation.',
      });
      expect(report.action).toBe('handed-off');
      expect(report.detail).toContain('Auto-fix disabled');
      expect(report.dispatch).toBeUndefined();
    } finally {
      delete process.env.DRAYMOND_REPAIR_BENCHMARK_ENABLED;
    }
  });
});

// Exploration is what turns the repair-Elo loop from inert into real: without a
// varying lead there is no head-to-head to learn from. These tests pin the
// safety properties — default is byte-identical, a bogus lead is ignored, and
// the round-robin is deterministic from the log.
describe('assembleCrew — lead selection', () => {
  it('is unchanged by default (stack primary)', () => {
    expect(assembleCrew('code_error').lead).toBe('opencode');
    expect(assembleCrew('chain_config').lead).toBe('opencode');
  });

  it('honours a preferred lead that is a real coding candidate', () => {
    const crew = assembleCrew('code_error', { preferredLead: 'megacode' });
    expect(crew.lead).toBe('megacode');
    expect(crew.members).not.toContain('megacode');
    expect(crew.reason).toContain('caller-preferred lead');
  });

  it('ignores a preferred lead from another vocabulary (no bogus lead installed)', () => {
    // Axiom's Dev-Brain lanes (keywire/sub-team/...) are services, not coding
    // leads; a mismatch must fall back, not install an engine that cannot fix code.
    const crew = assembleCrew('code_error', { preferredLead: 'keywire' });
    expect(crew.lead).toBe('opencode');
    expect(crew.reason).toContain('stack primary');
  });

  it('round-robins to the least-attempted candidate when exploring', () => {
    // Real codegen candidates: opencode, uplift-agent, megacode,
    // everything-claude-code, sub-team. Give every one a count so the least is
    // unambiguous rather than an unlisted candidate sitting at zero.
    const crew = assembleCrew('code_error', {
      explore: true,
      attempts: { opencode: 5, 'uplift-agent': 1, megacode: 3, 'everything-claude-code': 2, 'sub-team': 4 },
    });
    expect(crew.lead).toBe('uplift-agent');
  });

  it('prefers a caller lead over exploration', () => {
    const crew = assembleCrew('code_error', {
      preferredLead: 'megacode',
      explore: true,
      attempts: { opencode: 0, 'uplift-agent': 0, megacode: 9 },
    });
    expect(crew.lead).toBe('megacode');
  });

  it('leaves non-coding kinds untouched by lead options', () => {
    expect(assembleCrew('service_down', { preferredLead: 'megacode', explore: true }).lead).toBe('overlay-auditor');
    expect(assembleCrew('missing_env', { preferredLead: 'opencode' }).lead).toBe('uplift-agent');
    expect(assembleCrew('unknown', { explore: true }).lead).toBe('omniresearch-pro');
  });

  it('leastAttempted breaks ties by candidate order (deterministic)', () => {
    expect(leastAttempted(['a', 'b', 'c'], {})).toBe('a');
    expect(leastAttempted(['a', 'b', 'c'], { a: 2, b: 2 })).toBe('c');
  });

  it('leadAttemptsFromLog counts only the requested kind', () => {
    const attempts = leadAttemptsFromLog(
      [
        { failureKind: 'code_error', crew: { lead: 'opencode' } },
        { failureKind: 'code_error', crew: { lead: 'opencode' } },
        { failureKind: 'code_error', crew: { lead: 'uplift-agent' } },
        { failureKind: 'service_down', crew: { lead: 'overlay-auditor' } },
        { failureKind: 'code_error' },
      ],
      'code_error',
    );
    expect(attempts).toEqual({ opencode: 2, 'uplift-agent': 1 });
  });

  it('leadStatsFromLog credits only fixed as a fix (handed-off is an attempt, not a fix)', () => {
    const stats = leadStatsFromLog(
      [
        { failureKind: 'code_error', crew: { lead: 'opencode' }, action: 'fixed' },
        { failureKind: 'code_error', crew: { lead: 'opencode' }, action: 'handed-off' },
        { failureKind: 'code_error', crew: { lead: 'uplift-agent' }, action: 'escalated' },
      ],
      'code_error',
    );
    expect(stats.attempts).toEqual({ opencode: 2, 'uplift-agent': 1 });
    expect(stats.fixes).toEqual({ opencode: 1 });
  });
});

describe('bestLeadFromStats — the exploit half', () => {
  const candidates = ['opencode', 'uplift-agent', 'megacode', 'everything-claude-code', 'sub-team'];

  it('returns undefined until a challenger is measured', () => {
    expect(bestLeadFromStats({ attempts: { opencode: 3 }, fixes: { opencode: 2 } }, candidates)).toBeUndefined();
  });

  it('returns a challenger that measurably beats the primary', () => {
    const stats = {
      attempts: { opencode: 3, 'uplift-agent': 3 },
      fixes: { opencode: 0, 'uplift-agent': 3 },
    };
    expect(bestLeadFromStats(stats, candidates)).toBe('uplift-agent');
  });

  it('returns undefined when the primary is already best or equal', () => {
    const primaryBest = { attempts: { opencode: 3, 'uplift-agent': 3 }, fixes: { opencode: 3, 'uplift-agent': 1 } };
    expect(bestLeadFromStats(primaryBest, candidates)).toBeUndefined();
    const equal = { attempts: { opencode: 3, 'uplift-agent': 3 }, fixes: { opencode: 2, 'uplift-agent': 2 } };
    expect(bestLeadFromStats(equal, candidates)).toBeUndefined();
  });
});
