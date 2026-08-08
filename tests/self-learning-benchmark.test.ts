import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate the self-learning file store to a temp dir for the test.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-learn-bench-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

import {
  recordBenchmarkGain,
  recordBenchmarkGains,
  distillLessons,
} from '../src/lib/draymond/self-learning';

describe('self-learning benchmark gains', () => {
  beforeEach(() => {
    fs.rmSync(path.join(tmp, 'learning-outcomes.json'), { force: true });
    fs.rmSync(path.join(tmp, 'learning-lessons.json'), { force: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('records a positive benchmark gain as a success outcome', async () => {
    const outcome = await recordBenchmarkGain({
      agentId: 'grader',
      component: 'uplift-agent',
      scorer: 'reporank',
      baseline: 60,
      current: 90,
      gainPct: 50,
    });
    expect(outcome.kind).toBe('benchmark');
    expect(outcome.success).toBe(true);
    expect(outcome.detail).toContain('+50%');
    expect(outcome.detail).toContain('baseline=60 current=90');
  });

  it('records a regression as a failure outcome', async () => {
    const outcome = await recordBenchmarkGain({
      agentId: 'grader',
      component: 'megacode',
      scorer: 'grader',
      baseline: 80,
      current: 50,
      gainPct: -37.5,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.detail).toContain('-37.5%');
  });

  it('records an incalculable gain as neutral (not success)', async () => {
    const outcome = await recordBenchmarkGain({
      agentId: 'reporank',
      component: 'openchat',
      scorer: 'vibe-reality',
      baseline: null,
      current: 65,
      gainPct: null,
    });
    expect(outcome.success).toBe(false);
    expect(outcome.detail).toContain('gain=n/a');
  });

  it('records a batch of gains and returns one outcome per item', async () => {
    const outcomes = await recordBenchmarkGains([
      { agentId: 'a', component: 'x', scorer: 'reporank', baseline: 50, current: 60, gainPct: 20 },
      { agentId: 'a', component: 'x', scorer: 'grader', baseline: 60, current: 40, gainPct: -33.3 },
    ]);
    expect(outcomes).toHaveLength(2);
  });

  it('distills repeated benchmark regressions into a lesson', async () => {
    for (let i = 0; i < 3; i++) {
      await recordBenchmarkGain({
        agentId: 'megacode',
        component: 'megacode',
        scorer: 'grader',
        baseline: 80,
        current: 50,
        gainPct: -37.5,
      });
    }
    const lessons = await distillLessons();
    const failureLesson = lessons.find((l) => l.agentId === 'megacode' && l.lesson.includes('Repeated failure'));
    expect(failureLesson).toBeTruthy();
    expect(failureLesson?.agentId).toBe('megacode');
  });
});
