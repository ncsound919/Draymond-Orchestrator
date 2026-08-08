import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decideByMonteCarlo } from '../src/lib/ide/monte-carlo';

const execFileAsync = promisify(execFile);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ide-test-'));
  process.env.DRAYMOND_REGISTRY_DIR = tmpDir;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  delete process.env.DRAYMOND_REGISTRY_DIR;
});

/** Initialize a throwaway git repo in tmpDir for git-client tests. */
async function initGitRepo(): Promise<void> {
  await execFileAsync('git', ['init', '-q'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
}

describe('ide monte-carlo decision engine', () => {
  it('picks the high-EV, low-spread option', () => {
    const result = decideByMonteCarlo(
      [
        { id: 'safe', label: 'Safe bet', expectedOutcome: 80, outcomeSpread: 5 },
        { id: 'risky', label: 'Lottery ticket', expectedOutcome: 30, outcomeSpread: 60 },
      ],
      { trials: 10_000, seed: 42 },
    );
    expect(result.choiceId).toBe('safe');
    expect(result.options.find((o) => o.id === 'safe')?.pBest).toBeGreaterThan(0.5);
    expect(result.justification).toContain('Safe bet');
  });

  it('is reproducible for the same seed', () => {
    const a = decideByMonteCarlo([{ id: 'x', expectedOutcome: 10, outcomeSpread: 3 }], { seed: 7, trials: 2000 });
    const b = decideByMonteCarlo([{ id: 'x', expectedOutcome: 10, outcomeSpread: 3 }], { seed: 7, trials: 2000 });
    expect(a.choiceId).toBe(b.choiceId);
    expect(a.expectedUtility).toBeCloseTo(b.expectedUtility, 3);
  });

  it('penalises downside so a volatile option can lose to a stable one', () => {
    const result = decideByMonteCarlo(
      [
        { id: 'stable', label: 'Stable', expectedOutcome: 50, outcomeSpread: 4 },
        { id: 'swing', label: 'Swing', expectedOutcome: 60, outcomeSpread: 45 },
      ],
      { trials: 10_000, riskAversion: 1.2, seed: 3 },
    );
    // With heavy risk aversion the stable option should usually win.
    expect(result.choiceId).toBe('stable');
  });
});

describe('ide session manager', () => {
  it('creates a session with a crew, plan, and assembling phase', async () => {
    const { createIdeSession } = await import('../src/lib/ide/session-manager');
    const session = await createIdeSession({
      goal: 'fix the timeout bug in the scheduler job',
      createdBy: 'test',
    });
    expect(session.id).toBeTruthy();
    expect(session.phase).toBe('assembling');
    expect(session.crew.lead).toBeTruthy();
    expect(session.crew.members).toContain('codegang');
    expect(session.steps.length).toBeGreaterThanOrEqual(2);
    expect(session.events.some((e) => e.type === 'session.created')).toBe(true);
    expect(session.events.some((e) => e.type === 'crew.assembled')).toBe(true);
  });

  it('runs a session to completion even when engines are offline (fail soft)', async () => {
    const { createIdeSession, startIdeSession } = await import('../src/lib/ide/session-manager');
    const session = await createIdeSession({ goal: 'refactor the scoring pipeline', createdBy: 'test' });
    const done = await startIdeSession(session.id);
    expect(done.phase).toBe('done');
    expect(done.events.some((e) => e.type === 'session.completed')).toBe(true);
    for (const step of done.steps) {
      expect(['done', 'failed']).toContain(step.status);
    }
  });

  it('wires dependencies into a DAG and propagates failures to dependents', async () => {
    const { createIdeSession, startIdeSession } = await import('../src/lib/ide/session-manager');
    // repair kind → deterministic fallback DAG: diagnose → implement → verify → review.
    const session = await createIdeSession({ goal: 'fix the timeout bug in the scheduler', createdBy: 'test' });
    expect(session.steps[0].dependsOn).toBeUndefined();
    expect(session.steps[1].dependsOn).toEqual([session.steps[0].id]);
    expect(session.steps[3].dependsOn?.length).toBe(2);

    // Engines offline → diagnose (uplift) fails → implement/verify/review are blocked.
    const done = await startIdeSession(session.id);
    expect(done.steps[0].status).toBe('failed');
    expect(done.steps[1].status).toBe('failed');
    expect(done.steps[1].error).toContain('blocked');
    expect(done.steps[2].status).toBe('failed');
    expect(done.steps[3].status).toBe('failed');
  });

  it('handles interjections: message, redirect, pause, resume, abort', async () => {
    const { createIdeSession, interjectIdeSession, resolveIdeDecision } = await import('../src/lib/ide/session-manager');

    const session = await createIdeSession({ goal: 'add a /health endpoint to the payouts service', createdBy: 'test' });

    const withMessage = await interjectIdeSession(session.id, 'message', { content: 'use the existing auth middleware' });
    expect(withMessage.chat.some((m) => m.role === 'user' && m.content.includes('auth middleware'))).toBe(true);

    const redirected = await interjectIdeSession(session.id, 'redirect', { content: 'prioritise backwards compatibility' });
    expect(redirected.redirect).toBe('prioritise backwards compatibility');

    // Simulate a live running session to test pause/resume.
    const { saveSession } = await import('../src/lib/ide/session-store');
    await saveSession({ ...session, phase: 'running' as const });
    await interjectIdeSession(session.id, 'pause');
    const paused = await interjectIdeSession(session.id, 'resume');
    expect(paused.phase).toBe('running');

    // Inject a pending decision and resolve it like the decisions API does.
    const pending = { ...session, phase: 'waiting_decision' as const, decisions: [{ id: 'dec-1', prompt: 'Proceed?', risk: 'high' as const, reason: 'test', status: 'pending' as const, method: 'chat' as const, options: [{ id: 'go', label: 'Go' }] }] };
    await saveSession(pending);

    const resolved = await resolveIdeDecision(session.id, 'dec-1', { approved: true, reviewer: 'test', optionId: 'go' });
    expect(resolved.status).toBe('approved');
    expect(resolved.resolution).toBe('go');

    const aborted = await interjectIdeSession(session.id, 'abort');
    expect(aborted.phase).toBe('done');
  });

  it('records a session into memory and finds it again', async () => {
    const { createIdeSession, startIdeSession } = await import('../src/lib/ide/session-manager');
    const { recordSessionMemory, searchSessionMemory } = await import('../src/lib/ide/session-memory');

    const session = await createIdeSession({ goal: 'fix the timeout bug in the scheduler job', createdBy: 'test' });
    await startIdeSession(session.id);

    // startIdeSession already records; record again explicitly for determinism.
    const record = await recordSessionMemory(session);
    expect(record).not.toBeNull();
    expect(record!.goal).toContain('timeout');

    const hits = await searchSessionMemory('scheduler timeout', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.record.id.startsWith(session.id))).toBe(true);
    expect(hits[0].record.goal).toContain('timeout');
  });

  it('normalizes a generic Approve (ntfy button) into the review-loop vocabulary', async () => {
    const { createIdeSession, resolveIdeDecision } = await import('../src/lib/ide/session-manager');
    const { saveSession } = await import('../src/lib/ide/session-store');
    const session = await createIdeSession({ goal: 'add a /health endpoint', createdBy: 'test' });
    await saveSession({
      ...session,
      phase: 'waiting_decision' as const,
      decisions: [{ id: 'd1', prompt: 'ok?', risk: 'medium' as const, reason: 't', status: 'pending' as const, method: 'chat' as const, options: [] }],
    });
    // ntfy Approve posts { approved: true } with NO optionId.
    const resolved = await resolveIdeDecision(session.id, 'd1', { approved: true, reviewer: 'ntfy' });
    expect(resolved.status).toBe('approved');
    expect(resolved.resolution).toBe('approve'); // NOT 'approved' — must match the review loop
  });

  it('does not re-run an already-completed session', async () => {
    const { createIdeSession, startIdeSession } = await import('../src/lib/ide/session-manager');
    const session = await createIdeSession({ goal: 'refactor the pipeline', createdBy: 'test' });
    const first = await startIdeSession(session.id);
    expect(first.phase).toBe('done');
    const second = await startIdeSession(session.id);
    expect(second.phase).toBe('done');
    expect(second.events.filter((e) => e.type === 'session.completed').length).toBe(1);
  });

  it('abort releases a pending decision waiter so the runner does not hang', async () => {
    const { waitForDecision } = await import('../src/lib/ide/escalate');
    const { createIdeSession, interjectIdeSession } = await import('../src/lib/ide/session-manager');
    const { saveSession } = await import('../src/lib/ide/session-store');
    const session = await createIdeSession({ goal: 'add a /health endpoint', createdBy: 'test' });
    await saveSession({
      ...session,
      phase: 'waiting_decision' as const,
      decisions: [{ id: 'd1', prompt: 'ok?', risk: 'medium' as const, reason: 't', status: 'pending' as const, method: 'chat' as const, options: [] }],
    });
    const waiter = waitForDecision(session.id, 'd1');
    await interjectIdeSession(session.id, 'abort');
    const resolved = await Promise.race([waiter, new Promise((r) => setTimeout(() => r('timeout'), 2000))]);
    expect(resolved).not.toBe('timeout');
    expect((resolved as { status?: string }).status).toBe('rejected');
  });

  it('git client sees and commits workspace changes (Docker-free)', async () => {
    const { gitStatus, gitDiff, gitCommit } = await import('../src/lib/ide/git-client');
    await initGitRepo();
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n');

    const status = await gitStatus(tmpDir);
    expect(status.success).toBe(true);
    expect(status.output).toContain('a.ts');

    const diff = await gitDiff(tmpDir);
    expect(diff.success).toBe(true);
    expect(diff.output).toContain('+export const a = 1;');

    const commit = await gitCommit(tmpDir, 'feat: add a.ts');
    expect(commit.success).toBe(true);
    expect(commit.output.trim()).toMatch(/^[0-9a-f]+$/);

    const statusAfter = await gitStatus(tmpDir);
    expect(statusAfter.output.trim()).toBe('');
  }, 60_000);

  it('command runner executes presets and reports failures', async () => {
    const { runWorkspaceCommand } = await import('../src/lib/ide/command-runner');

    // typecheck on a plain directory → tsc reports "no inputs found" (non-zero).
    const res = await runWorkspaceCommand(tmpDir, 'typecheck');
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();

    // A preset named by a prompt keyword resolves to the same preset.
    const resolved = await runWorkspaceCommand(tmpDir, 'run the typecheck to verify types');
    expect(resolved.preset).toBe('typecheck');

    // Unknown workspace → clean failure, not a throw.
    const missing = await runWorkspaceCommand(path.join(tmpDir, 'nope'), 'test');
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('workspace not found');
  }, 60_000);

  it('runs git-diff and git-commit steps end-to-end', async () => {
    const { createIdeSession, startIdeSession } = await import('../src/lib/ide/session-manager');
    const { saveSession } = await import('../src/lib/ide/session-store');
    // Keep the git repo OUTSIDE the memory dir so the memory DB never lands in it.
    const repoDir = path.join(tmpDir, 'repo');
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, 'base.ts'), 'export const base = 1;\n');
    await execFileAsync('git', ['add', '-A'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-q', '-m', 'chore: base'], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, 'base.ts'), 'export const base = 2;\n');
    await fs.writeFile(path.join(repoDir, 'new.ts'), 'export const fresh = true;\n');

    const session = await createIdeSession({ goal: 'commit the changes', createdBy: 'test', workspace: repoDir });
    session.steps = [
      { id: 'g1', index: 0, title: 'Show diff', kind: 'git-diff', agent: 'mutly', prompt: 'show the working tree diff', status: 'queued' },
      { id: 'g2', index: 1, title: 'Commit', kind: 'git-commit', agent: 'mutly', prompt: 'commit the changes', status: 'queued', dependsOn: ['g1'] },
    ];
    await saveSession(session);

    const done = await startIdeSession(session.id);
    expect(done.phase).toBe('done');
    expect(done.steps[0].status).toBe('done');
    expect(done.events.some((e) => e.type === 'file.diff')).toBe(true);
    expect(done.steps[1].status).toBe('done');
    expect(done.steps[1].detail).toContain('committed');

    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: repoDir });
    expect(status.stdout.trim()).toBe('');
  });

  it('recovery sweep marks dead running sessions as error and records memory', async () => {
    const { createIdeSession } = await import('../src/lib/ide/session-manager');
    const { saveSession, loadSession } = await import('../src/lib/ide/session-store');
    const { runRecoverySweep } = await import('../src/lib/ide/recovery');

    const session = await createIdeSession({ goal: 'fix the timeout bug', createdBy: 'test' });
    // Simulate a runner that died mid-run.
    await saveSession({ ...session, phase: 'running' as const });

    const recovered = await runRecoverySweep({ force: true });
    expect(recovered).toBeGreaterThan(0);

    const after = await loadSession(session.id);
    expect(after?.phase).toBe('error');
    expect(after?.note).toContain('restart');
  });

  it('recovery sweep is idempotent and leaves waiting_decision-without-decision stranded as error', async () => {
    const { createIdeSession } = await import('../src/lib/ide/session-manager');
    const { saveSession, loadSession } = await import('../src/lib/ide/session-store');
    const { runRecoverySweep } = await import('../src/lib/ide/recovery');

    // A waiting_decision session with no pending decisions → error.
    const a = await createIdeSession({ goal: 'add a /health endpoint', createdBy: 'test' });
    await saveSession({ ...a, phase: 'waiting_decision' as const, decisions: [{ id: 'x', prompt: 'p', risk: 'medium' as const, reason: 'r', status: 'rejected' as const, method: 'chat' as const, options: [] }] });
    const recovered = await runRecoverySweep({ force: true });
    expect(recovered).toBeGreaterThan(0);
    expect((await loadSession(a.id))?.phase).toBe('error');

    // Idempotency: a second sweep (no force) recovers nothing.
    const second = await runRecoverySweep();
    expect(second).toBe(0);
  });

  it('benchmark run persists a baseline and feeds self-learning outcomes', async () => {
    const { runIdeBenchmark, getLatestBenchmarkRun } = await import('../src/lib/ide/benchmark');
    const workspace = path.join(tmpDir, 'bench');
    await fs.mkdir(workspace, { recursive: true });

    // Fast run: skip the landing-page finisher and opencode (engines are offline in tests).
    const run = await runIdeBenchmark({ workspaceRoot: workspace, skipLandingPage: true, skipCodegen: true });
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.results.some((r) => r.task === 'reachability')).toBe(true);
    expect(run.results.some((r) => r.task === 'git-workflow')).toBe(true);

    const latest = await getLatestBenchmarkRun();
    expect(latest?.runId).toBe(run.runId);

    // Self-learning outcomes were recorded (kind 'benchmark', per tool).
    const outcomesFile = path.join(tmpDir, 'learning-outcomes.json');
    const raw = await fs.readFile(outcomesFile, 'utf-8');
    const outcomes = JSON.parse(raw) as Array<{ kind: string; agentId: string; success: boolean }>;
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((o) => o.kind === 'benchmark')).toBe(true);
  }, 60_000);

  it('probe classifies a down service and remediation offers a restart action', async () => {
    const { probeService } = await import('../src/lib/ide/service-probe');
    const { collectRemediation } = await import('../src/lib/ide/repair-skills');

    // megacode is a registry service that is not running in tests.
    const diagnosis = await probeService('megacode');
    expect(diagnosis.listening).toBe(false);
    expect(['not_started', 'crash_loop', 'unreachable']).toContain(diagnosis.signature);

    const { items } = await collectRemediation({ probe: diagnosis });
    const restart = items.find((i) => i.apply?.type === 'restart');
    expect(restart).toBeTruthy();
    expect(restart?.apply?.service).toBe('megacode');
  });

  it('repair executor applies env-set and patch actions safely', async () => {
    const { applyRemediationAction } = await import('../src/lib/ide/repair-executor');

    await fs.writeFile(path.join(tmpDir, '.env'), 'PORT=3000\n');
    const env = await applyRemediationAction({ type: 'env-set', key: 'PORT', value: '3200' }, tmpDir);
    expect(env.ok).toBe(true);
    const envContent = await fs.readFile(path.join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('PORT=3200');

    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'const x = 1;\n');
    const patch = await applyRemediationAction({ type: 'patch', file: 'a.ts', find: 'const x = 1;', replace: 'const x = 2;' }, tmpDir);
    expect(patch.ok).toBe(true);
    expect(await fs.readFile(path.join(tmpDir, 'a.ts'), 'utf-8')).toContain('const x = 2;');
    expect(await fs.readFile(path.join(tmpDir, 'a.ts.bak'), 'utf-8')).toContain('const x = 1;');

    // Missing anchor → safe failure.
    const miss = await applyRemediationAction({ type: 'patch', file: 'a.ts', find: 'not there', replace: 'x' }, tmpDir);
    expect(miss.ok).toBe(false);

    // Path escape → rejected.
    const escape = await applyRemediationAction({ type: 'patch', file: '../secret.txt', find: 'a', replace: 'b' }, tmpDir);
    expect(escape.ok).toBe(false);

    // Raw command validation blocks shell metacharacters.
    const bad = await applyRemediationAction({ type: 'command', args: ['npm', 'install', '--prefix', 'x; rm -rf /'] }, tmpDir);
    expect(bad.ok).toBe(false);
  });
});
