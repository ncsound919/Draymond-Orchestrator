// ============================================================================
// DRAYMOND AGENT IDE — benchmark baseline
// ============================================================================
// A standard, repeatable benchmark that exercises every tool in the coding
// stack and records a baseline. Each run produces per-tool results
// (success / duration / score), persists the baseline under
// .draymond/ide-benchmark/baseline.json, and feeds every outcome into the
// self-learning store — so the repair team and future sessions learn from what
// the benchmark measures. Docker-free: everything runs as local processes.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { toolHealthUrl } from '../draymond/ports';
import { codegangAnalyzeFile, codegangFinishProject, codegangIsUp } from './codegang-client';
import { runWorkspaceCommand } from './command-runner';
import { gitStatus, gitDiff, gitCommit, isGitRepo } from './git-client';
import { recordOutcome } from '../draymond/self-learning';

export type BenchmarkTask =
  | 'landing-page'
  | 'codegen'
  | 'codegang-analyze'
  | 'command-typecheck'
  | 'git-workflow'
  | 'reachability';

export interface IdeBenchmarkResult {
  tool: string;
  task: BenchmarkTask;
  success: boolean;
  duration_ms: number;
  score?: number | null;
  files?: number;
  error?: string;
  detail?: string;
  ts: string;
}

export interface IdeBenchmarkRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  results: IdeBenchmarkResult[];
}

export interface IdeBenchmarkBaseline {
  updatedAt: string;
  runs: IdeBenchmarkRun[];
}

const BENCH_DIR = () => path.join(process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'), 'ide-benchmark');
const BASELINE_FILE = () => path.join(BENCH_DIR(), 'baseline.json');
const MAX_RUNS = 20;

const TOOL_PROBES: Array<{ slug: string; label: string }> = [
  { slug: 'uplift-agent', label: 'uplift' },
  { slug: 'mutly', label: 'mutly' },
  { slug: 'codegang', label: 'codegang' },
  { slug: 'reporank', label: 'reporank' },
  { slug: 'grader', label: 'grader' },
  { slug: 'agent-browser', label: 'agent-browser' },
  { slug: 'big-homie', label: 'big-homie' },
  { slug: 'vibeserve', label: 'vibeserve' },
  { slug: 'megacode', label: 'megacode' },
  { slug: 'opencode', label: 'opencode' },
];

function makeResult(input: Omit<IdeBenchmarkResult, 'ts'>): IdeBenchmarkResult {
  return { ...input, ts: new Date().toISOString() };
}

// ── Per-tool tasks ──────────────────────────────────────────────────────────

async function benchmarkReachability(): Promise<IdeBenchmarkResult[]> {
  const results: IdeBenchmarkResult[] = await Promise.all(
    TOOL_PROBES.map(async ({ slug, label }) => {
      const started = Date.now();
      const url = toolHealthUrl(slug);
      if (!url) {
        return makeResult({ tool: label, task: 'reachability', success: false, duration_ms: Date.now() - started, error: 'no health URL', detail: `slug ${slug} not in the port registry` });
      }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
        const ok = res.status >= 200 && res.status < 500;
        return makeResult({
          tool: label,
          task: 'reachability',
          success: ok,
          duration_ms: Date.now() - started,
          error: ok ? undefined : `HTTP ${res.status}`,
          detail: ok ? url : `${url} → HTTP ${res.status}`,
        });
      } catch (err) {
        return makeResult({ tool: label, task: 'reachability', success: false, duration_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err), detail: url });
      }
    }),
  );
  return results;
}

/** The standard benchmark code sample (deliberately mediocre — stable signal). */
const SAMPLE_CODE = [
  'export function loadUser(id: string) {',
  '  const sql = `SELECT * FROM users WHERE id = ` + id;',
  '  return db.query(sql);',
  '}',
  'export async function process(items: any[]) {',
  '  for (let i = 0; i < items.length; i++) {',
  '    if (items[i] == null) continue;',
  '    items[i].value = items[i].value * 2;',
  '  }',
  '}',
].join('\n');

async function benchmarkCodegangAnalyze(): Promise<IdeBenchmarkResult> {
  const started = Date.now();
  const up = await codegangIsUp();
  if (!up) {
    return makeResult({ tool: 'codegang', task: 'codegang-analyze', success: false, duration_ms: Date.now() - started, error: 'codegang unreachable', detail: 'offline — no local analysis signal' });
  }
  const res = await codegangAnalyzeFile({ filePath: 'bench/sample.ts', content: SAMPLE_CODE, language: 'typescript' });
  return makeResult({
    tool: 'codegang',
    task: 'codegang-analyze',
    success: res.success,
    duration_ms: Date.now() - started,
    score: res.metrics?.qualityScore ?? null,
    error: res.success ? undefined : res.error,
    detail: res.success ? `${res.metrics?.totalIssues ?? 0} issues (${res.metrics?.criticalCount ?? 0} crit / ${res.metrics?.highCount ?? 0} high)` : undefined,
  });
}

/** Build a basic landing page via Codegang's deterministic Project Finisher. */
async function benchmarkLandingPage(workspaceRoot: string): Promise<IdeBenchmarkResult> {
  const started = Date.now();
  const projDir = path.join(workspaceRoot, 'landing-page');
  await fs.mkdir(projDir, { recursive: true });
  await fs.writeFile(
    path.join(projDir, 'README.md'),
    [
      '# Acme Landing Page',
      '',
      'A basic marketing landing page for a startup.',
      '',
      '## Features',
      '',
      '- [x] Hero section with headline and call to action',
      '- [x] Features grid highlighting product capabilities',
      '- [ ] Pricing table with three tiers',
      '- [ ] Contact form with validation',
      '- [ ] Footer with links and copyright',
      '',
      '## Tech Stack',
      '',
      '- Next.js',
      '- TypeScript',
      '- Tailwind CSS',
    ].join('\n'),
    'utf-8',
  );

  const res = await codegangFinishProject({ projectPath: projDir, maxIterations: 1 });

  // The finisher writes files server-side even if the client times out during
  // its (slow, npx cold-start) validation — count what was actually generated.
  let files = 0;
  try {
    const all = await fs.readdir(projDir, { recursive: true });
    files = all.filter((f) => typeof f === 'string' && !f.toString().includes('node_modules')).length;
  } catch {
    files = (res.filesCreated?.length ?? 0) + (res.filesModified?.length ?? 0);
  }

  return makeResult({
    tool: 'codegang',
    task: 'landing-page',
    success: files > 0,
    duration_ms: Date.now() - started,
    score: res.completionScore ?? null,
    files,
    error: files > 0 ? undefined : (res.error ?? 'no files generated'),
    detail:
      files > 0
        ? `generated ${files} file(s), completion ${res.completionScore ?? 'n/a'}${res.error ? ` — ${res.error}` : ''}`
        : `no files generated — ${res.error ?? 'finisher failed'}`,
  });
}

/** Real codegen benchmark: opencode writes a TS module, Codegang scores it. */
async function benchmarkOpencodeCodegen(workspaceRoot: string): Promise<IdeBenchmarkResult> {
  const started = Date.now();
  const dir = path.join(workspaceRoot, 'codegen');
  await fs.mkdir(dir, { recursive: true });

  const prompt = [
    'Create a TypeScript file fib.ts in this directory exporting a function',
    'fibonacci(n: number): number that returns the nth Fibonacci number (0-indexed).',
    'Validate input (throw on negative/non-integer), handle n=0 -> 0, n=1 -> 1, and use',
    'an iterative implementation. No comments needed.',
  ].join(' ');

  const { runOpencodeCodegen, extractCodeBlocks } = await import('./opencode-client');
  const r = await runOpencodeCodegen({ prompt, workspace: dir, timeoutMs: 90_000 });

  // opencode's headless server writes files relative to its own cwd, so we
  // capture the code from the reply and materialize it in the workspace.
  const blocks = r.success ? extractCodeBlocks(r.content, 'ts') : [];
  let score: number | null = null;
  let analyzeError: string | undefined;
  const file = path.join(dir, 'fib.ts');
  let generated = false;
  if (r.success && blocks.length > 0) {
    try {
      await fs.writeFile(file, blocks[0], 'utf-8');
      generated = true;
      const { codegangAnalyzeFile } = await import('./codegang-client');
      const res = await codegangAnalyzeFile({ filePath: 'codegen/fib.ts', content: blocks[0], language: 'typescript' });
      score = res.metrics?.qualityScore ?? null;
      if (!res.success) analyzeError = res.error;
    } catch {
      analyzeError = 'could not write generated file';
    }
  } else if (r.success) {
    analyzeError = 'no code block in opencode reply';
  }

  return makeResult({
    tool: 'opencode',
    task: 'codegen',
    success: r.success && generated && score != null,
    duration_ms: Date.now() - started,
    score,
    files: generated ? 1 : 0,
    error: r.success ? (analyzeError ?? undefined) : r.error,
    detail: r.success
      ? `opencode generated fib.ts → codegang ${score ?? 'n/a'}/100${analyzeError ? ` (${analyzeError})` : ''}`
      : `opencode failed: ${r.error ?? 'unknown'}`,
  });
}

async function benchmarkCommandTypecheck(workspaceRoot: string): Promise<IdeBenchmarkResult> {
  const started = Date.now();
  // Run in a clean empty subdir so other tasks' files don't influence the signal.
  const dir = path.join(workspaceRoot, 'typecheck');
  await fs.mkdir(dir, { recursive: true });
  const res = await runWorkspaceCommand(dir, 'typecheck');
  return makeResult({
    tool: 'command-runner',
    task: 'command-typecheck',
    success: res.success,
    duration_ms: Date.now() - started,
    error: res.error,
    detail: res.success ? `${res.preset} passed` : `${res.command} → ${res.error ?? 'failed'}`,
  });
}

async function benchmarkGitWorkflow(workspaceRoot: string): Promise<IdeBenchmarkResult> {
  const started = Date.now();
  const repo = path.join(workspaceRoot, 'git-bench');
  await fs.mkdir(repo, { recursive: true });
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('git', ['init', '-q'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'bench@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Bench'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    await execFileAsync('git', ['add', '-A'], { cwd: repo });
    await execFileAsync('git', ['commit', '-q', '-m', 'chore: base'], { cwd: repo });
    await fs.writeFile(path.join(repo, 'a.ts'), 'export const a = 2;\n');
    await fs.writeFile(path.join(repo, 'b.ts'), 'export const b = true;\n');

    const repoOk = await isGitRepo(repo);
    const status = await gitStatus(repo);
    const diff = await gitDiff(repo);
    const commit = await gitCommit(repo, 'bench: change a and add b');
    const clean = await gitStatus(repo);
    const success = repoOk && status.success && diff.success && commit.success && clean.success && clean.output.trim() === '';
    return makeResult({
      tool: 'git-client',
      task: 'git-workflow',
      success,
      duration_ms: Date.now() - started,
      error: success ? undefined : 'git workflow did not leave a clean tree',
      detail: success ? `status+diff+commit ok` : `repo=${repoOk} status=${status.success} diff=${diff.success} commit=${commit.success} clean=${clean.success}`,
    });
  } catch (err) {
    return makeResult({ tool: 'git-client', task: 'git-workflow', success: false, duration_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
  }
}

// ── Run + baseline persistence ──────────────────────────────────────────────

async function loadBaseline(): Promise<IdeBenchmarkBaseline> {
  try {
    const raw = await fs.readFile(BASELINE_FILE(), 'utf-8');
    return JSON.parse(raw) as IdeBenchmarkBaseline;
  } catch {
    return { updatedAt: new Date().toISOString(), runs: [] };
  }
}

async function saveBaseline(run: IdeBenchmarkRun): Promise<IdeBenchmarkBaseline> {
  const baseline = await loadBaseline();
  baseline.runs.push(run);
  baseline.runs = baseline.runs.slice(-MAX_RUNS);
  baseline.updatedAt = new Date().toISOString();
  await fs.mkdir(BENCH_DIR(), { recursive: true });
  await fs.writeFile(BASELINE_FILE(), JSON.stringify(baseline, null, 2), 'utf-8');
  return baseline;
}

/** Feed every result into the self-learning store so lessons cluster over runs. */
async function feedSelfLearning(run: IdeBenchmarkRun): Promise<void> {
  for (const r of run.results) {
    await recordOutcome({
      agentId: r.tool,
      kind: 'benchmark',
      summary: `${r.tool} ${r.task} benchmark`,
      success: r.success,
      detail: `${r.success ? 'ok' : 'FAILED'} · ${r.duration_ms}ms${r.score != null ? ` · score ${r.score}` : ''}${r.error ? ` · ${r.error}` : ''}`,
    }).catch(() => {});
  }
}

export interface RunIdeBenchmarkOptions {
  workspaceRoot?: string;
  /** Skip the (slow) landing-page finisher build — used by fast tests. */
  skipLandingPage?: boolean;
  /** Skip the opencode codegen task (spawns a real server) — used by fast tests. */
  skipCodegen?: boolean;
}

/** Run the full benchmark, persist the baseline, feed self-learning. */
export async function runIdeBenchmark(opts: RunIdeBenchmarkOptions = {}): Promise<IdeBenchmarkRun> {
  const runId = `bench-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const workspaceRoot = opts.workspaceRoot ?? path.join(BENCH_DIR(), 'runs', runId);
  await fs.mkdir(workspaceRoot, { recursive: true });

  const results: IdeBenchmarkResult[] = [];
  results.push(...(await benchmarkReachability()));

  if (!opts.skipLandingPage) {
    results.push(await benchmarkLandingPage(workspaceRoot));
  }
  if (!opts.skipCodegen) {
    results.push(await benchmarkOpencodeCodegen(workspaceRoot));
  }
  results.push(await benchmarkCodegangAnalyze());
  results.push(await benchmarkCommandTypecheck(workspaceRoot));
  results.push(await benchmarkGitWorkflow(workspaceRoot));

  const run: IdeBenchmarkRun = { runId, startedAt, finishedAt: new Date().toISOString(), results };

  await saveBaseline(run);
  await feedSelfLearning(run);

  return run;
}

/** Latest baseline: the most recent run, or the whole history. */
export async function getIdeBenchmarkBaseline(): Promise<IdeBenchmarkBaseline> {
  return loadBaseline();
}

/** Most recent run (empty results when none exists yet). */
export async function getLatestBenchmarkRun(): Promise<IdeBenchmarkRun | null> {
  const baseline = await loadBaseline();
  return baseline.runs[baseline.runs.length - 1] ?? null;
}
