import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

export const dynamic = 'force-dynamic';

const runFile = promisify(execFile);

function repoRoot(): string {
  if (process.env.SCIENCE_ROOT) return process.env.SCIENCE_ROOT;
  return path.resolve(/*turbopackIgnore: true*/ process.cwd());
}

/**
 * Model validation report.
 *   GET /api/v1/science/validation  → runs the validated predictive models and
 *   returns AUC / C-index / Brier / backtest metrics.
 */
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const root = repoRoot();
    const { stdout } = await runFile(
      process.env.SCIENCE_PYTHON ?? 'python',
      ['-c', 'import json,sys; sys.path.insert(0, "."); from science_engine.validation import summary; print(json.dumps(summary()))'],
      { cwd: root, env: { ...process.env, PYTHONPATH: root }, timeout: 900_000 }
    );
    const report = JSON.parse(stdout);
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    return NextResponse.json({ ok: false, error: sanitizeError(err) }, { status: 500 });
  }
}
