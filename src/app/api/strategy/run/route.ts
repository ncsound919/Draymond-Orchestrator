import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

// Resolve the agent-team directory. Prefer env override; default to the
// workspace sibling path (this repo and the agent-team live under Uplift/).
function agentTeamDir(): string {
  if (process.env.AGENT_TEAM_DIR) return process.env.AGENT_TEAM_DIR;
  return resolve(process.cwd(), '../01_Platforms/Overlay365/agent-team');
}

const RUN_TIMEOUT_MS = 60_000;

export async function POST(req: Request) {
  const dir = agentTeamDir();
  let request: Record<string, unknown>;
  try {
    request = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(join(tmpdir(), 'strategy-run-'));
    const inputFile = join(tmpDir, 'request.json');
    await writeFile(inputFile, JSON.stringify(request), 'utf-8');

    const serveRel = join('agents', 'strategist', 'serve.ts');
    const cmd = `npx tsx ${serveRel} --input=${inputFile}`;

    // win32: npx is a .cmd shim — route through cmd.exe (see command-runner.ts).
    const { stdout } = await (process.platform === 'win32'
      ? execFileAsync('cmd.exe', ['/d', '/s', '/c', cmd], { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
      : execFileAsync('npx', ['tsx', serveRel, `--input=${inputFile}`], { cwd: dir, timeout: RUN_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }));

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return NextResponse.json({ ok: false, error: 'Unparseable output from strategy runner' }, { status: 500 });
    }
    return NextResponse.json(parsed);
  } catch (err: any) {
    const isTimeout = err && typeof err === 'object' && err.killed === true;
    return NextResponse.json(
      { ok: false, error: isTimeout ? 'Strategy run timed out' : `Strategy runner failed: ${err?.message ?? String(err)}` },
      { status: 500 }
    );
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }
}
