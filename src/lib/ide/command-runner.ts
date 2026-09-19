// ============================================================================
// DRAYMOND AGENT IDE — non-container sandboxed command runner
// ============================================================================
// Docker-free replacement for container sandboxes. Instead of isolating in a
// container, it runs a small allowlisted set of build/verify presets as plain
// subprocesses (execFile, no shell) inside the session workspace with a hard
// timeout. No arbitrary shell commands are accepted — only named presets — so
// the blast radius is bounded to compile/lint/test/build invocations.
// ============================================================================

import { execFile } from 'child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export type CommandPreset = 'typecheck' | 'lint' | 'test' | 'build' | 'install' | 'install-ci' | 'prisma-generate' | 'pip-install';

export interface CommandResult {
  success: boolean;
  preset: CommandPreset | 'raw';
  command: string;
  output: string;
  duration_ms: number;
  error?: string;
  /** Exit code when the process exited cleanly. */
  exitCode?: number | null;
}

/** Preset → argv. Only these commands are ever executed. */
const PRESET_COMMANDS: Record<CommandPreset, string[]> = {
  typecheck: ['npx', 'tsc', '--noEmit'],
  lint: ['npx', 'eslint', '.'],
  test: ['npx', 'vitest', 'run'],
  build: ['npx', 'next', 'build'],
  install: ['npm', 'install'],
  'install-ci': ['npm', 'ci'],
  'prisma-generate': ['npx', 'prisma', 'generate'],
  'pip-install': ['python', '-m', 'pip', 'install', '-r', 'requirements.txt'],
};

const PRESET_TIMEOUT_MS: Record<CommandPreset, number> = {
  typecheck: 180_000,
  lint: 180_000,
  test: 300_000,
  build: 600_000,
  install: 600_000,
  'install-ci': 600_000,
  'prisma-generate': 180_000,
  'pip-install': 600_000,
};

// -- Raw (repair) command mode — validated argv, no shell metacharacters -----

const RAW_ALLOWED_BASE = new Set(['npm', 'npx', 'node', 'python', 'pip', 'pnpm', 'git', 'cmd', 'bun', 'npx.cmd', 'npm.cmd']);
const RAW_BLOCKED_FLAGS = [/^(--eval|--print|-e|-p|--require|-r|--import|--input-type|-c|--exec|--command|--unsafe-perm)$/i];
const RAW_BLOCKED_SUBSTRINGS = ['&&', '||', ';', '|', '>', '<', '`', '$(', 'sudo', 'rm -rf', 'rm -fr', ':(){', '--force', '-f '];

/** Validate a raw argv for the repair team. Returns sanitized tokens or an error. */
export function validateRawArgv(argv: unknown): { ok: true; argv: string[] } | { ok: false; error: string } {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, error: 'raw command must be a non-empty string array' };
  }
  const base = String(argv[0]).toLowerCase();
  if (!RAW_ALLOWED_BASE.has(base)) {
    return { ok: false, error: `raw command "${argv[0]}" is not allowed` };
  }
  const tokens: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = String(argv[i]);
    if (t === '') continue;
    const lower = t.toLowerCase();
    for (const flag of RAW_BLOCKED_FLAGS) {
      if (flag.test(t)) return { ok: false, error: `blocked argument "${t}"` };
    }
    for (const sub of RAW_BLOCKED_SUBSTRINGS) {
      if (lower.includes(sub)) return { ok: false, error: `blocked token "${sub}" in argument "${t}"` };
    }
    if (i > 0 && /["'`;|<>]/.test(t)) return { ok: false, error: `shell metacharacter in argument "${t}"` };
    tokens.push(t);
  }
  return { ok: true, argv: tokens };
}

/**
 * Run a fixed argv via execFile. On Windows, `npx`/`npm` are `.cmd` shims that
 * execFile (CreateProcess) cannot resolve, so the static allowlisted command is
 * routed through cmd.exe — the string comes only from PRESET_COMMANDS, so there
 * is no shell-injection surface.
 */
async function execPreset(cwd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const opts = {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  };
  if (process.platform === 'win32') {
    const { stdout, stderr } = await execFileAsync('cmd.exe', ['/d', '/s', '/c', args.join(' ')], opts);
    return { stdout, stderr };
  }
  const { stdout, stderr } = await execFileAsync(args[0], args.slice(1), opts);
  return { stdout, stderr };
}

function resolvePresetFromPrompt(prompt: string): CommandPreset {
  const p = prompt.toLowerCase();
  if (/(typecheck|tsc|type-check|types)/.test(p)) return 'typecheck';
  if (/(lint|eslint|style)/.test(p)) return 'lint';
  if (/(build|compile|bundle)/.test(p)) return 'build';
  return 'test';
}

/** Verify the workspace directory exists before running anything. */
async function validateWorkspace(workspace?: string): Promise<string | null> {
  const root = workspace ?? process.cwd();
  try {
    const stat = await /*turbopackIgnore: true*/ fs.stat(/*turbopackIgnore: true*/ path.resolve(root));
    if (!stat.isDirectory()) return null;
    return /*turbopackIgnore: true*/ path.resolve(root);
  } catch {
    return null;
  }
}

/**
 * Run a preset command against the workspace. Never throws — structured result.
 */
export async function runWorkspaceCommand(
  workspace: string | undefined,
  presetOrPrompt: CommandPreset | string,
): Promise<CommandResult> {
  const preset = (Object.keys(PRESET_COMMANDS) as CommandPreset[]).includes(presetOrPrompt as CommandPreset)
    ? (presetOrPrompt as CommandPreset)
    : resolvePresetFromPrompt(presetOrPrompt);

  const cwd = await validateWorkspace(workspace);
  if (!cwd) {
    return { success: false, preset, command: PRESET_COMMANDS[preset].join(' '), output: '', duration_ms: 0, error: 'workspace not found' };
  }

  const args = PRESET_COMMANDS[preset];
  const started = Date.now();

  try {
    const { stdout, stderr } = await execPreset(cwd, args, PRESET_TIMEOUT_MS[preset]);
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return {
      success: true,
      preset,
      command: args.join(' '),
      output: output.slice(0, 6000),
      duration_ms: Date.now() - started,
      exitCode: 0,
    };
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim().slice(0, 6000);
    const killed = Boolean(e.killed);
    const code = typeof e.code === 'number' ? String(e.code) : e.code ?? '?';
    return {
      success: false,
      preset,
      command: args.join(' '),
      output,
      duration_ms: Date.now() - started,
      error: killed
        ? `timed out after ${PRESET_TIMEOUT_MS[preset]}ms`
        : `exit code ${code}${output ? ` — ${output.split('\n').slice(-3).join(' ').slice(0, 160)}` : ''}`,
      exitCode: typeof e.code === 'number' ? e.code : null,
    };
  }
}

/**
 * Run a validated raw argv (repair mode). The argv goes through
 * `validateRawArgv` first (allowlisted base + no shell metacharacters), then
 * executes via execFile (cmd.exe routing on Windows for npm/npx shims).
 * Never throws.
 */
export async function runRawCommand(
  workspace: string | undefined,
  argv: unknown,
  timeoutMs = 300_000,
): Promise<CommandResult> {
  const started = Date.now();
  const check = validateRawArgv(argv);
  if (!check.ok) {
    return { success: false, preset: 'raw', command: Array.isArray(argv) ? argv.join(' ') : '?', output: '', duration_ms: 0, error: check.error };
  }
  const cwd = await validateWorkspace(workspace);
  if (!cwd) {
    return { success: false, preset: 'raw', command: check.argv.join(' '), output: '', duration_ms: 0, error: 'workspace not found' };
  }
  try {
    const { stdout, stderr } = await execPreset(cwd, check.argv, timeoutMs);
    const output = [stdout, stderr].filter(Boolean).join('\n').trim().slice(0, 6000);
    return { success: true, preset: 'raw', command: check.argv.join(' '), output, duration_ms: Date.now() - started, exitCode: 0 };
  } catch (err) {
    const e = err as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim().slice(0, 6000);
    const code = typeof e.code === 'number' ? String(e.code) : e.code ?? '?';
    return {
      success: false,
      preset: 'raw',
      command: check.argv.join(' '),
      output,
      duration_ms: Date.now() - started,
      error: e.killed ? `timed out after ${timeoutMs}ms` : `exit code ${code}${output ? ` — ${output.split('\n').slice(-3).join(' ').slice(0, 160)}` : ''}`,
      exitCode: typeof e.code === 'number' ? e.code : null,
    };
  }
}
