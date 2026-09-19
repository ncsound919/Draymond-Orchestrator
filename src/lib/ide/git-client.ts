// ============================================================================
// DRAYMOND AGENT IDE — workspace git client (Docker-free)
// ============================================================================
// Runs allowlisted git commands in the session workspace as plain subprocesses
// (execFile, no shell) so nothing needs Docker or a container runtime. The
// command/argument surface is locked down: only a known set of git subcommands
// is permitted and file paths are verified to stay inside the workspace.
// ============================================================================

import { execFile } from 'child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export interface GitOpResult {
  success: boolean;
  output: string;
  error?: string;
}

const ALLOWED_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'add',
  'commit',
  'checkout',
  'stash',
  'remote',
  'rev-parse',
  'ls-files',
]);

/** Guard: only allowlisted git subcommands may be issued (defense in depth). */
function assertSubcommand(args: string[]): boolean {
  return args.length > 0 && ALLOWED_SUBCOMMANDS.has(args[0]);
}

async function runGit(workspace: string | undefined, args: string[], timeoutMs = 60_000): Promise<GitOpResult> {
  const cwd = workspace ?? process.cwd();
  if (!assertSubcommand(args)) {
    return { success: false, output: '', error: `git subcommand "${args[0] ?? ''}" is not allowed` };
  }
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });
    return { success: true, output: stdout };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Verify a workspace-relative file path stays inside the workspace (real path). */
async function workspacePath(workspace: string | undefined, filePath: string): Promise<string | null> {
  const root = workspace ?? process.cwd();
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  try {
    const realRoot = await /*turbopackIgnore: true*/ fs.realpath(root);
    const realAbs = await fs.realpath(abs);
    const a = process.platform === 'win32' ? realAbs.toLowerCase() : realAbs;
    const r = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
    if (a !== r && !a.startsWith(r + path.sep)) return null;
    return realAbs;
  } catch {
    return null;
  }
}

/** git status --short (untracked/modified/deleted surface). */
export async function gitStatus(workspace?: string): Promise<GitOpResult> {
  return runGit(workspace, ['status', '--short']);
}

/** git diff --stat (summary of the working-tree changes). */
export async function gitDiffStat(workspace?: string): Promise<GitOpResult> {
  return runGit(workspace, ['diff', '--stat']);
}

/** Unified diff of the working tree (or a single workspace file), including
 *  untracked files rendered as new-file diffs (agents create new files). */
export async function gitDiff(workspace?: string, filePath?: string): Promise<GitOpResult> {
  let abs: string | null = null;
  if (filePath) {
    abs = await workspacePath(workspace, filePath);
    if (!abs) return { success: false, output: '', error: 'file path escapes the workspace' };
  }

  const tracked = abs ? await runGit(workspace, ['diff', '--', abs]) : await runGit(workspace, ['diff']);

  // Untracked files don't appear in `git diff` — surface them as new-file hunks.
  const status = await runGit(workspace, ['status', '--porcelain'], 15_000);
  const untracked = status.success
    ? status.output
        .split('\n')
        .filter((l) => l.startsWith('?? '))
        .map((l) => l.slice(3).trim())
    : [];

  let extra = '';
  const root = (workspace ?? process.cwd());
  for (const rel of untracked) {
    if (abs && rel !== filePath) continue;
    try {
      const stat = await /*turbopackIgnore: true*/ fs.stat(path.resolve(root, rel));
      if (!stat.isFile()) continue;
      const content = await /*turbopackIgnore: true*/ fs.readFile(path.resolve(root, rel), 'utf-8');
      extra += `\n\ndiff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n${content
        .split('\n')
        .map((l) => `+${l}`)
        .join('\n')}\n`;
    } catch {
      // skip unreadable untracked entries
    }
  }

  return { success: tracked.success, output: `${tracked.output}${extra}`, error: tracked.error };
}

/** Current branch name. */
export async function gitBranch(workspace?: string): Promise<GitOpResult> {
  return runGit(workspace, ['branch', '--show-current']);
}

/** Stage everything and commit with the given message. */
export async function gitCommit(workspace: string | undefined, message: string): Promise<GitOpResult> {
  const add = await runGit(workspace, ['add', '-A'], 30_000);
  if (!add.success) return add;
  const commit = await runGit(workspace, ['commit', '-m', message], 60_000);
  if (!commit.success) return commit;
  // Return the short hash for the record.
  return runGit(workspace, ['rev-parse', '--short', 'HEAD'], 15_000);
}

/** Most recent commit hash (e.g. for a record line after a commit). */
export async function gitHead(workspace?: string): Promise<GitOpResult> {
  return runGit(workspace, ['rev-parse', '--short', 'HEAD'], 15_000);
}

/** True when the workspace is inside a git repository. */
export async function isGitRepo(workspace?: string): Promise<boolean> {
  const res = await runGit(workspace, ['rev-parse', '--is-inside-work-tree'], 15_000);
  return res.success && res.output.trim() === 'true';
}
