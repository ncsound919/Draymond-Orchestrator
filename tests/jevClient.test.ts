import { describe, expect, it } from 'vitest';
import {
  jevEnabled,
  decideSystemOne,
  decideFor,
  dailyTaskAdvisory,
  buildDailyTaskAdvisory,
  cronRunAdvisory,
  buildCronRunAdvisory,
  repairAdvisory,
  buildRepairAdvisory,
  reportAdvisory,
  buildReportAdvisory,
  learningAdvisory,
  buildLearningAdvisory,
  serviceLifecycleAdvisory,
  buildServiceLifecycleAdvisory,
  bringUpChoiceAdvisory,
  buildBringUpChoiceAdvisory,
  brainDecisionAdvisory,
  buildBrainDecisionAdvisory,
  type JevResult,
} from '../src/lib/draymond/jevClient';

describe('jevEnabled', () => {
  it('is enabled by default (gateway or local base present) and needs no key', () => {
    delete process.env.DRAYMOND_JEV_ENABLED;
    expect(jevEnabled()).toBe(true);
  });
});

describe('decideSystemOne offline gate', () => {
  it('returns ok:false offline when disabled, never fabricating', async () => {
    process.env.DRAYMOND_JEV_ENABLED = '0';
    try {
      const r = await decideSystemOne({ state: 's', questions: { go: { type: 'noul', instructions: 'Go?' } } });
      expect(r.ok).toBe(false);
      expect(r.source).toBe('offline');
      expect(r.error).toMatch(/disabled/);
    } finally {
      delete process.env.DRAYMOND_JEV_ENABLED;
    }
  });
});

describe('dailyTaskAdvisory', () => {
  it('builds first-choice + load-score and parses answers', () => {
    const { state, questions } = dailyTaskAdvisory([
      { id: 't1', label: 'Repair failed job' },
      { id: 't2', label: 'Publish report' },
    ]);
    expect((state as { action: string }).action).toBe('daily_tasks');
    expect(questions.first.type).toBe('choice');
    expect(questions.load.type).toBe('score');

    const result: JevResult = {
      ok: true,
      source: 'vercel',
      model: 'typesafe-ai/jev',
      answers: {
        first: { type: 'choice', choice: 't1', probabilities: { t1: 0.8, t2: 0.2 }, confidence: 0.9 },
        load: { type: 'score', score: 1.2, legend: { '0': 'Light', '1': 'Moderate', '2': 'Heavy', '3': 'Overwhelming' }, probabilities: {}, confidence: 0.6 },
      },
      latencyMs: 60,
    };
    const advisory = buildDailyTaskAdvisory(result);
    expect(advisory.firstTask).toBe('t1');
    expect(advisory.loadScore).toBeCloseTo(1.2);
    expect(advisory.source).toBe('vercel');
  });
});

describe('cronRunAdvisory', () => {
  it('builds run-noul + priority-score and parses answers', () => {
    const { questions } = cronRunAdvisory({ name: 'circle-report', job_type: 'report' });
    expect(questions.run.type).toBe('noul');
    expect(questions.priority.type).toBe('score');

    const result: JevResult = {
      ok: true,
      source: 'localjev',
      model: 'localjev-0.2',
      answers: {
        run: { type: 'noul', noul: 0.93 },
        priority: { type: 'score', score: 2.1, legend: { '0': 'Low', '1': 'Normal', '2': 'High', '3': 'Critical' }, probabilities: {}, confidence: 0.8 },
      },
      latencyMs: 20,
    };
    const advisory = buildCronRunAdvisory(result);
    expect(advisory.run).toBe(true);
    expect(advisory.noul).toBeCloseTo(0.93);
    expect(advisory.priorityScore).toBeCloseTo(2.1);
  });
});

describe('repairAdvisory', () => {
  it('builds lane-choice + dispatch-noul and parses answers', () => {
    const { questions } = repairAdvisory({ signal: 'job x failed', kind: 'code_error' });
    expect(questions.lane.type).toBe('choice');
    expect(questions.dispatch.type).toBe('noul');

    const result: JevResult = {
      ok: true,
      source: 'localjev',
      model: 'localjev-0.2',
      answers: {
        lane: { type: 'choice', choice: 'coding', probabilities: { coding: 0.7, config: 0.1, service: 0.15, escalate: 0.05 }, confidence: 0.8 },
        dispatch: { type: 'noul', noul: 0.6 },
      },
      latencyMs: 15,
    };
    const advisory = buildRepairAdvisory(result);
    expect(advisory.lane).toBe('coding');
    expect(advisory.dispatch).toBe(true);
  });
});

describe('reportAdvisory', () => {
  it('parses publish-noul + value-score', () => {
    const { questions } = reportAdvisory({ topic: 'weekly fleet health', length: 1200 });
    expect(questions.publish.type).toBe('noul');

    const result: JevResult = {
      ok: true,
      source: 'vercel',
      model: 'typesafe-ai/jev',
      answers: {
        publish: { type: 'noul', noul: 0.7 },
        value: { type: 'score', score: 2.4, legend: { '0': 'Low', '1': 'Moderate', '2': 'High', '3': 'Critical' }, probabilities: {}, confidence: 0.7 },
      },
      latencyMs: 40,
    };
    const advisory = buildReportAdvisory(result);
    expect(advisory.publish).toBe(true);
    expect(advisory.valueScore).toBeCloseTo(2.4);
  });
});

describe('learningAdvisory', () => {
  it('builds learn-choice + value-score and parses answers', () => {
    const { questions } = learningAdvisory([{ id: 'l1', lesson: 'never retry flaky jobs 3x', evidenceCount: 5 }]);
    expect(questions.learn.type).toBe('choice');

    const result: JevResult = {
      ok: true,
      source: 'localjev',
      model: 'localjev-0.2',
      answers: {
        learn: { type: 'choice', choice: 'l1', probabilities: { l1: 0.9 }, confidence: 0.85 },
        value: { type: 'score', score: 2.2, legend: { '0': 'Low', '1': 'Moderate', '2': 'High', '3': 'Transformative' }, probabilities: {}, confidence: 0.7 },
      },
      latencyMs: 18,
    };
    const advisory = buildLearningAdvisory(result);
    expect(advisory.lessonId).toBe('l1');
    expect(advisory.valueScore).toBeCloseTo(2.2);
  });
});

describe('serviceLifecycleAdvisory', () => {
  it('builds proceed-noul + risk-score for bring-up and power-down', () => {
    const service = { slug: 'recourse', name: 'Recourse', port: 3050, health: 'down' };
    const start = serviceLifecycleAdvisory(service, 'start');
    const stop = serviceLifecycleAdvisory({ ...service, health: 'healthy' }, 'stop');
    expect((start.state as { action: string }).action).toBe('service_start');
    expect((stop.state as { action: string }).action).toBe('service_stop');
    expect(start.questions.proceed.type).toBe('noul');
    expect(start.questions.risk.type).toBe('score');

    const result: JevResult = {
      ok: true,
      source: 'vercel',
      model: 'typesafe-ai/jev',
      answers: {
        proceed: { type: 'noul', noul: 0.88 },
        risk: { type: 'score', score: 0.2, legend: { '0': 'None', '1': 'Low', '2': 'Medium', '3': 'High' }, probabilities: {}, confidence: 0.7 },
      },
      latencyMs: 30,
    };
    const advisory = buildServiceLifecycleAdvisory(result);
    expect(advisory.proceed).toBe(true);
    expect(advisory.riskScore).toBeCloseTo(0.2);
  });
});

describe('bringUpChoiceAdvisory', () => {
  it('builds a first-choice over down services + load score and parses answers', () => {
    const down = [
      { slug: 'recourse', name: 'Recourse', port: 3050, health: 'down' },
      { slug: 'keywire', name: 'Keywire', port: 3000, health: 'down' },
    ];
    const { state, questions } = bringUpChoiceAdvisory(down);
    expect((state as { action: string }).action).toBe('service_bringup');
    expect(questions.first.type).toBe('choice');
    expect(questions.load.type).toBe('score');

    const result: JevResult = {
      ok: true,
      source: 'vercel',
      model: 'typesafe-ai/jev',
      answers: {
        first: { type: 'choice', choice: 'keywire', probabilities: { keywire: 0.7, recourse: 0.3 }, confidence: 0.8 },
        load: { type: 'score', score: 0.9, legend: { '0': 'Light', '1': 'Moderate', '2': 'Heavy', '3': 'Very heavy' }, probabilities: {}, confidence: 0.6 },
      },
      latencyMs: 45,
    };
    const advisory = buildBringUpChoiceAdvisory(result);
    expect(advisory.firstSlug).toBe('keywire');
    expect(advisory.firstProbability).toBeCloseTo(0.7);
    expect(advisory.loadScore).toBeCloseTo(0.9);
    expect(advisory.source).toBe('vercel');
  });
});

describe('brainDecisionAdvisory', () => {
  it('builds focus-choice + act-noul and parses answers', () => {
    const { questions } = brainDecisionAdvisory({ focusGoal: 'Revenue engine E1', priorities: [{ id: 'p1', label: 'Fix keywire auth' }], repairQueueLength: 2 });
    expect(questions.focus.type).toBe('choice');
    expect(questions.act.type).toBe('noul');

    const result: JevResult = {
      ok: true,
      source: 'localjev',
      model: 'localjev-0.2',
      answers: {
        focus: { type: 'choice', choice: 'p1', probabilities: { p1: 0.85 }, confidence: 0.9 },
        act: { type: 'noul', noul: 0.75 },
      },
      latencyMs: 12,
    };
    const advisory = buildBrainDecisionAdvisory(result);
    expect(advisory.focusId).toBe('p1');
    expect(advisory.act).toBe(true);
  });
});

describe('decideFor', () => {
  it('returns an offline advisory without touching the network when disabled', async () => {
    process.env.DRAYMOND_JEV_ENABLED = '0';
    try {
      const { jev } = await decideFor('repair', { failure: { signal: 'x', kind: 'code_error' } });
      expect(jev.ok).toBe(false);
      expect(jev.source).toBe('offline');
    } finally {
      delete process.env.DRAYMOND_JEV_ENABLED;
    }
  });
});