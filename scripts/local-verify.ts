#!/usr/bin/env tsx
/**
 * Local build/verify runner — actually executes the target repo's real
 * toolchain: TypeScript type-check, lint, tests, and build (whichever the
 * repo defines). This closes the "no real build/test execution" gap that the
 * static analyzers cannot cover.
 *
 * Prints findings JSON on stdout:
 *   { engine: 'verify', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-verify.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const EXCLUDE_STEPS = /^(clean|watch|dev|preview|storybook|qa:suite|lint:fix|format|test:watch|test:ui)$/;

interface StepResult {
  ok: boolean;
  step: string;
  durationMs: number;
  exitCode: number | null;
  error?: string;
  sample?: string;
}

function readPackage(dir: string): Record<string, unknown> | null {
  const p = path.join(dir, 'package.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<StepResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : cmd,
      process.platform === 'win32' ? ['/c', cmd, ...args] : args,
      { cwd, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - started;
        const exitCode = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
        const full = `${stdout}\n${stderr}`;
        if (err && !(err as { killed?: boolean }).killed) {
          const sample = full
            .split('\n')
            .filter((l) => /error|failed|cannot|TS\d+|✖|✗|FAIL|not found|no such/i.test(l))
            .slice(0, 6)
            .join('\n');
          resolve({
            ok: false,
            step: `${cmd} ${args.join(' ')}`,
            durationMs,
            exitCode,
            error: (err as Error).message.slice(0, 300),
            sample: sample || full.slice(0, 800),
          });
          return;
        }
        const failed = /error|failed|cannot|TS\d+|✖|✗|FAIL/i.test(full) && !/0 errors|no errors|passed/i.test(full);
        resolve({
          ok: !failed,
          step: `${cmd} ${args.join(' ')}`,
          durationMs,
          exitCode,
          sample: failed ? full.split('\n').filter((l) => /error|failed|TS\d+|✖|✗|FAIL/i.test(l)).slice(0, 8).join('\n').slice(0, 1200) : undefined,
          error: failed ? full.split('\n').filter((l) => /error|failed|TS\d+|✖|✗|FAIL/i.test(l)).slice(0, 2).join(' | ').slice(0, 300) : undefined,
        });
      },
    );
  });
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-verify.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const pkg = readPackage(root);

  const findings: Record<string, unknown>[] = [];
  const steps: StepResult[] = [];

  // -- TypeScript type-check --
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
    steps.push(await run('npx', ['tsc', '--noEmit'], root, 180_000));
  }

  // -- Scripts from package.json (build, test, lint — no servers/watch) --
  const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};
  const ordered = ['lint', 'typecheck', 'type-check', 'test', 'build'];
  const seen = new Set<string>();
  for (const name of ordered) {
    if (scripts[name] && !seen.has(name)) {
      seen.add(name);
      const step = await run('npm', ['run', name, '--if-present'], root, 600_000);
      steps.push(step);
    }
  }
  // any remaining non-watch scripts (max 2)
  for (const [name, cmd] of Object.entries(scripts)) {
    if (seen.has(name) || !cmd || EXCLUDE_STEPS.test(name) || typeof cmd !== 'string') continue;
    seen.add(name);
    steps.push(await run('npm', ['run', name, '--if-present'], root, 600_000));
    if (seen.size >= 6) break;
  }

  // Convert failed steps to findings
  const bySeverity: Record<string, number> = {};
  for (const s of steps) {
    if (s.ok) continue;
    const sev = s.step.includes('build') ? 'critical' : s.step.includes('test') ? 'high' : 'high';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    findings.push({
      severity: sev,
      category: s.step.includes('build') ? 'build' : s.step.includes('test') ? 'test' : 'typecheck',
      title: `Command failed: ${s.step}`,
      description: (s.error ?? s.sample ?? 'command failed').slice(0, 1200),
      file: undefined,
      line: undefined,
      exitCode: s.exitCode,
      durationMs: s.durationMs,
      engine: 'verify',
    });
  }

  const passedSteps = steps.filter((s) => s.ok).map((s) => s.step);

  console.log(JSON.stringify({
    engine: 'verify',
    findings,
    summary: {
      stepsRun: steps.length,
      passed: passedSteps,
      failedCount: findings.length,
      bySeverity,
      durationMs: steps.reduce((a, s) => a + s.durationMs, 0),
      hasPackageJson: Boolean(pkg),
    },
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
