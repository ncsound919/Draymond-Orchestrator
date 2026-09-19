process.env.DRAYMOND_DB_PATH = ':memory:';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canCallProvider, consumeTokens, acquireLane, releaseLane, laneStatus, laneSnapshot, resetBudget, isOnCooldown,
} from '../src/lib/draymond/workflow-budget';
import { supervise, bigHomieGate } from '../src/lib/draymond/supervisor';

let _wbTmp: string;
beforeAll(() => {
  _wbTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-wb-'));
  process.env.DRAYMOND_REGISTRY_DIR = _wbTmp;
});
afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  try { fs.rmSync(_wbTmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('workflow budget', () => {
  beforeEach(() => resetBudget());

  it('gates providers once their daily token budget is exhausted', () => {
    expect(canCallProvider('deepseek').ok).toBe(true);
    // consume beyond the budget
    for (let i = 0; i < 300; i++) consumeTokens('deepseek', 4000); // 1.2M > 1M
    expect(canCallProvider('deepseek').ok).toBe(false);
    expect(canCallProvider('deepseek').reason).toContain('budget exhausted');
  });

  it('freezes a task lane when in-flight is at capacity and reopens on release', () => {
    expect(acquireLane('overlay-auditor', 2)).toBe(true);
    expect(acquireLane('overlay-auditor', 2)).toBe(true);
    // Third acquire should fail — plate is full.
    expect(acquireLane('overlay-auditor', 2)).toBe(false);
    expect(laneStatus('overlay-auditor', 2).frozen).toBe(true);
    // Release one → lane reopens.
    releaseLane('overlay-auditor');
    expect(acquireLane('overlay-auditor', 2)).toBe(true);
  });

  it('cooldown suppresses a repeated op within the window', () => {
    expect(isOnCooldown('overlay-auditor', 'qa', 60_000)).toBe(false); // first run allowed
    expect(isOnCooldown('overlay-auditor', 'qa', 60_000)).toBe(true); // suppressed
  });

  it('snapshots lane state', () => {
    acquireLane('sports-steve', 1);
    const snap = laneSnapshot();
    expect(snap['sports-steve']?.open).toBe(false);
    expect(snap['sports-steve']?.inFlight).toBe(1);
  });
});

describe('Big Homie supervisor', () => {
  it('approves complete, evidence-backed output', () => {
    const verdict = supervise({
      agentId: 'overlay-auditor', task: 'QA run', output: 'All 4 sites passed. Evidence: uptime + console checks. No errors.',
      requires: ['passed'],
    });
    expect(verdict.approved).toBe(true);
  });

  it('rejects output missing required markers', () => {
    const verdict = supervise({
      agentId: 'overlay-strategist', task: 'roadmap', output: 'short', requires: ['cluster', 'score'],
    });
    expect(verdict.approved).toBe(false);
    expect(verdict.reasons.some((r) => r.includes('marker'))).toBe(true);
  });

  it('bigHomieGate records the verdict to learning', async () => {
    const verdict = await bigHomieGate('overlay-treasurer', 'cash pulse', 'Complete report. passed.', ['passed']);
    expect(verdict.approved).toBe(true);
    const { getLessons } = await import('../src/lib/draymond/self-learning');
    // Recording an outcome is best-effort; no throw.
    expect(Array.isArray(await getLessons())).toBe(true);
  });
});
