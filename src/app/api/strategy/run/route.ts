import { NextRequest, NextResponse } from 'next/server';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Resolve the agent-team directory. Prefer env override; default to the
// workspace sibling path (this repo and the agent-team live under Uplift/).
function agentTeamDir(): string {
  if (process.env.AGENT_TEAM_DIR) return process.env.AGENT_TEAM_DIR;
  return resolve(/*turbopackIgnore: true*/ process.cwd(), '../01_Platforms/Overlay365/agent-team');
}

const RUN_TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  const dir = agentTeamDir();
  const { data: request, error: parseError } = await parseJsonBody<Record<string, unknown>>(req);
  if (parseError) return parseError;

  let tmpDir: string | null = null;
  try {
    try {
      await stat(dir);
    } catch {
      return NextResponse.json({ ok: false, error: `agent-team not found at ${dir}` }, { status: 500 });
    }
    tmpDir = await mkdtemp(join(tmpdir(), 'strategy-run-'));
    const inputFile = join(tmpDir, 'request.json');
    await writeFile(inputFile, JSON.stringify(request), 'utf-8');

    const serveRel = join('agents', 'strategist', 'serve.ts');
    const cmd = `npx tsx ${serveRel} --input="${inputFile}"`;

    // win32: npx is a .cmd shim — route through cmd.exe. `exec` passes the raw
    // command string (no argv re-quoting like execFile), so cmd.exe strips the
    // quotes around the input path and serve.ts receives an unquoted path.
    const { stdout } = await (process.platform === 'win32'
      ? execAsync(cmd, { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
      : execFileAsync('npx', ['tsx', serveRel, `--input=${inputFile}`], { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }));

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return NextResponse.json({ ok: false, error: 'Unparseable output from strategy runner' }, { status: 500 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const isTimeout =
      err && typeof err === 'object' && (err as { killed?: unknown }).killed === true;
    console.error('[strategy/run] runner failed:', err);
    return NextResponse.json(
      { ok: false, error: isTimeout ? 'Strategy run timed out' : 'Strategy runner failed to execute' },
      { status: 500 }
    );
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}
