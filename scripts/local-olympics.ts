#!/usr/bin/env tsx
/**
 * Local Benchmark Olympics runner — replicates what the Olympics app's
 * /api/grading/repo does, but for a LOCAL directory (no GitHub URL). It runs
 * the RepoRank + Grader dir-scorers plus the CodeNexus deep-audit scorer
 * concurrently and emits a benchmark-style report with per-engine scores.
 *
 * Prints JSON on stdout:
 *   { engine: 'olympics', results: [{ id, name, score, grade, summary }], summary }
 *
 * Usage: npx tsx scripts/local-olympics.ts <localDir>
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { loadDotEnvLocal } from './lib/load-dotenv-local.ts';

function runScorer(script: string, repo: string): Promise<{ ok: boolean; data: unknown; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32'
        ? ['/c', 'npx', 'tsx', path.join(__dirname, script), repo]
        : ['tsx', path.join(__dirname, script), repo],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, data: null, error: (stderr || err.message).trim().slice(0, 300) });
          return;
        }
        const match = stdout.match(/\{[\s\S]*\}/);
        if (!match) {
          resolve({ ok: false, data: null, error: 'Scorer returned no JSON' });
          return;
        }
        try {
          resolve({ ok: true, data: JSON.parse(match[0]) });
        } catch (e) {
          resolve({ ok: false, data: null, error: e instanceof Error ? e.message : 'Invalid JSON' });
        }
      }
    );
  });
}

async function main() {
  loadDotEnvLocal();
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npx tsx scripts/local-olympics.ts <localDir>');
    process.exit(1);
  }

  const root = path.resolve(target);
  const started = Date.now();

  const [reporank, grader, codenexus] = await Promise.all([
    runScorer('local-reporank-dir.ts', root),
    runScorer('local-grader-dir.ts', root),
    runScorer('local-codenexus.ts', root),
  ]);

  const results = [
    {
      id: 'reporank',
      name: 'RepoRank',
      ...(reporank.ok ? { ok: true, data: reporank.data as Record<string, unknown> } : { ok: false, error: reporank.error }),
    },
    {
      id: 'grader',
      name: 'Grader',
      ...(grader.ok ? { ok: true, data: grader.data as Record<string, unknown> } : { ok: false, error: grader.error }),
    },
    {
      id: 'codenexus',
      name: 'CodeNexus',
      ...(codenexus.ok ? { ok: true, data: codenexus.data as Record<string, unknown> } : { ok: false, error: codenexus.error }),
    },
  ];

  // CodeNexus emits findings, not an overallScore — derive a 0-100 score from
  // real finding severities (critical=20, high=8, medium=3, low=1).
  const codenexusData = codenexus.ok ? (codenexus.data as Record<string, unknown>) : null;
  const codenexusSummary = codenexusData?.summary as
    | { risk?: string; bySeverity?: Record<string, number>; filesScanned?: number }
    | undefined;
  const bySev = codenexusSummary?.bySeverity ?? {};
  const codenexusScore = codenexus.ok
    ? Math.max(0, Math.min(100, 100 - (Number(bySev.critical ?? 0) * 20 + Number(bySev.high ?? 0) * 8 + Number(bySev.medium ?? 0) * 3 + Number(bySev.low ?? 0))))
    : null;

  const scores = results
    .filter((r): r is { id: string; name: string; ok: boolean; data: Record<string, unknown> } =>
      'data' in r && r.ok && typeof (r as { data: Record<string, unknown> }).data?.overallScore === 'number')
    .map((r) => Number(r.data.overallScore));
  if (codenexusScore != null) scores.push(codenexusScore);
  const composite = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  console.log(JSON.stringify({
    engine: 'olympics',
    results,
    summary: {
      filesScanned: null,
      compositeScore: composite,
      gradeCategory: composite >= 90 ? 'A+' : composite >= 80 ? 'A' : composite >= 70 ? 'B' : composite >= 60 ? 'C' : 'D',
      durationMs: Date.now() - started,
    },
  }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
