import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function repoRoot(): string {
  if (process.env.SPORTS_ROOT) return process.env.SPORTS_ROOT;
  if (typeof __dirname !== 'undefined') return path.resolve(/*turbopackIgnore: true*/ __dirname, '../../..');
  return path.resolve(process.cwd());
}

// The sports-cli binary is produced by `cargo build --workspace` in core/.
// SPORTS_CORE_BIN overrides discovery (e.g. a release build or CI cache).
function resolveCoreBin(): string {
  if (process.env.SPORTS_CORE_BIN) return process.env.SPORTS_CORE_BIN;
  const repo = repoRoot();
  const candidates = [
    path.join(repo, 'core', 'target', 'debug', 'sports-cli.exe'),
    path.join(repo, 'core', 'target', 'debug', 'sports-cli'),
    path.join(repo, 'core', 'target', 'release', 'sports-cli.exe'),
    path.join(repo, 'core', 'target', 'release', 'sports-cli'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('sports-cli binary not found. Run `cargo build --workspace` in core/ (or set SPORTS_CORE_BIN).');
}

// The CLI reads its request from stdin and prints one JSON line to stdout, so
// a plain execFile can't feed it — use spawn with piped stdin/stdout/stderr.
function runFile(bin: string, payload: string, timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('sports-cli timed out'));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `sports-cli exited ${code}: ${Buffer.concat(stderr).toString().trim() || 'no stderr'}`,
          ),
        );
      } else {
        resolve({ stdout: Buffer.concat(stdout).toString() });
      }
    });
    child.stdin.on('error', () => {
      // The child may exit before stdin is flushed; close handler decides.
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

export interface RustResult {
  success: boolean;
  data: Record<string, unknown>;
  error: string | null;
  evidence_tier: string;
}

// The CLI speaks a strict JSON envelope: { command, input } on stdin and
// { ok, data } | { ok, error } on stdout. Every executor returns a RustResult
// shaped like PythonResult so the DAG gate and store treat it identically.
async function runCli(command: string, input: unknown): Promise<RustResult> {
  let bin: string;
  try {
    bin = resolveCoreBin();
  } catch (err) {
    return {
      success: false,
      data: {},
      error: err instanceof Error ? err.message : String(err),
      evidence_tier: 'E1',
    };
  }
  const payload = JSON.stringify({ command, input });
  try {
    const { stdout } = await runFile(bin, payload, 30_000);
    const parsed = JSON.parse(stdout);
    if (!parsed.ok) {
      return {
        success: false,
        data: {},
        error: parsed.error ?? 'unknown cli error',
        evidence_tier: 'E1',
      };
    }
    // Wrap the single result in the { data: [...] } contract the validate gate
    // runs against, mirroring pythonExecutors.wrap.
    return { success: true, data: { data: [parsed.data] }, error: null, evidence_tier: 'E1' };
  } catch (err) {
    return {
      success: false,
      data: {},
      error: err instanceof Error ? err.message : String(err),
      evidence_tier: 'E1',
    };
  }
}

export async function runRustSimPlay(input: Record<string, unknown>): Promise<RustResult> {
  return runCli('sim-play', input);
}

export async function runRustSimBatch(input: Record<string, unknown>): Promise<RustResult> {
  return runCli('sim-batch', input);
}
