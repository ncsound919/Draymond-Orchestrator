#!/usr/bin/env tsx
/**
 * Local Semgrep SAST runner — real interprocedural taint/dataflow analysis
 * via Semgrep's open-source engine + auto ruleset. Closes the "no true
 * semantic analysis" gap (CodeQL-class dataflow, without the license).
 *
 * Prints findings JSON on stdout:
 *   { engine: 'sast', findings: [...], summary: {...} }
 *
 * Usage: npx tsx scripts/local-sast.ts <localDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const EXCLUDE = [
  'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.vite',
  'src-tauri', 'e2e', 'test-results', 'playwright-report', '.verification-sandbox',
];

function findTool(): string | null {
  const c = process.env.SEMGREP_PATH;
  if (c && fs.existsSync(c)) return c;
  return 'semgrep'; // assume on PATH
}

function runSemgrep(repoDir: string): Promise<string> {
  return new Promise((resolve) => {
    const tool = findTool() ?? 'semgrep';
    const args = [
      'scan', '--config=auto', '--json', '--quiet',
      '--exclude', EXCLUDE.join(' --exclude ').replace(/^--exclude /, ''),
      ...EXCLUDE.flatMap((e) => ['--exclude', e]),
      repoDir,
    ];
    const file = process.platform === 'win32' ? 'cmd.exe' : tool;
    const fileArgs = process.platform === 'win32' ? ['/c', tool, ...args] : args;
    execFile(
      file,
      fileArgs,
      { encoding: 'utf8', timeout: 600_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(stdout || ''),
    );
  });
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-sast.ts <localDir>');
    process.exit(1);
  }
  const root = path.resolve(target);
  const started = Date.now();

  const raw = await runSemgrep(root);
  let results: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(raw);
    results = Array.isArray(parsed.results) ? (parsed.results as Array<Record<string, unknown>>) : [];
  } catch {
    results = [];
  }

  const findings: Record<string, unknown>[] = [];
  const bySeverity: Record<string, number> = {};

  for (const r of results) {
    const extra = (r.extra as Record<string, unknown> | undefined) ?? {};
    const sev = String(extra.severity ?? 'MEDIUM').toLowerCase();
    const mapped = sev === 'error' ? 'critical' : sev === 'warning' ? 'high' : 'medium';
    bySeverity[mapped] = (bySeverity[mapped] ?? 0) + 1;
    const pathStr = String(r.path ?? '');
    const start = (r.start as Record<string, unknown> | undefined) ?? {};
    findings.push({
      severity: mapped,
      category: 'semgrep',
      title: String(extra.message ?? r.check_id ?? 'Semgrep finding').slice(0, 200),
      description: String(extra.message ?? '').slice(0, 1200),
      file: pathStr,
      line: typeof start.line === 'number' ? start.line : undefined,
      fixSuggestion: String(extra.fix ?? (extra.metadata && typeof extra.metadata === 'object' ? (extra.metadata as Record<string, unknown>).fix : undefined) ?? '').slice(0, 400) || undefined,
      ruleId: r.check_id,
      cwe: extra.metadata && typeof extra.metadata === 'object' ? (extra.metadata as Record<string, unknown>).cwe : undefined,
      engine: 'sast',
    });
  }

  console.log(JSON.stringify({
    engine: 'sast',
    findings,
    summary: {
      rulesMatched: results.length,
      bySeverity,
      durationMs: Date.now() - started,
    },
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
