// ============================================================================
// DRAYMOND AGENT IDE — repair executor
// ============================================================================
// Applies a structured repair action produced by the remediation collector
// (Codegang self-heal / RepoRank / Grader) or the service probe. Each action is
// scoped and validated: file patches are workspace-contained (realpath-checked,
// exact-match, backed up), raw commands pass the allowlist validator, and
// restarts spawn the service's catalogued start command detached. Docker-free.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { IdeRepairAction } from './types';
import { runRawCommand, runWorkspaceCommand, type CommandPreset } from './command-runner';
import { toolBySlug } from '../draymond/ports';

export interface RepairOutcome {
  ok: boolean;
  detail: string;
}

/** Resolve a workspace path and verify the REAL path stays inside the root. */
async function safeRealPath(root: string, p: string): Promise<string | null> {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  try {
    const realRoot = await fs.realpath(root);
    const realAbs = await fs.realpath(abs);
    const a = process.platform === 'win32' ? realAbs.toLowerCase() : realAbs;
    const r = process.platform === 'win32' ? realRoot.toLowerCase() : realRoot;
    if (a !== r && !a.startsWith(r + path.sep)) return null;
    return realAbs;
  } catch {
    return null;
  }
}

async function applyPatch(root: string, file: string, find: string, replace: string): Promise<RepairOutcome> {
  const real = await safeRealPath(root, file);
  if (!real) return { ok: false, detail: `patch target escapes the workspace: ${file}` };
  let content: string;
  try {
    content = await /*turbopackIgnore: true*/ fs.readFile(real, 'utf-8');
  } catch {
    return { ok: false, detail: `cannot read ${file}` };
  }
  const target = find.trim();
  if (!content.includes(target)) {
    return { ok: false, detail: `patch anchor not found in ${file} (exact match required)` };
  }
  const replaced = content.replace(target, replace);
  await fs.writeFile(`${real}.bak`, content, 'utf-8');
  await fs.writeFile(real, replaced, 'utf-8');
  return { ok: true, detail: `patched ${file} (${target.length}→${replace.length} chars, backup written)` };
}

async function applyEnvSet(root: string, envFile: string | undefined, key: string, value: string): Promise<RepairOutcome> {
  // Env keys are restricted to the POSIX identifier grammar. This both rejects
  // malformed input and guarantees `key` is regex-safe before interpolation.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return { ok: false, detail: `invalid env key: ${key}` };
  }
  const file = envFile ?? '.env';
  const real = await safeRealPath(root, file);
  if (!real) return { ok: false, detail: `env file escapes the workspace: ${file}` };
  let content = '';
  try {
    content = await /*turbopackIgnore: true*/ fs.readFile(real, 'utf-8');
  } catch {
    // missing file → create it
  }
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- key is validated to the env-identifier grammar above.
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(content) ? content.replace(re, `${key}=${value}`) : `${content.replace(/\n*$/, '')}\n${key}=${value}\n`;
  await fs.writeFile(real, next, 'utf-8');
  return { ok: true, detail: `set ${key} in ${file}` };
}

/** Start a service from the port-registry start command, detached. */
async function restartService(service: string): Promise<RepairOutcome> {
  const tool = toolBySlug(service);
  if (!tool || !tool.start) {
    return { ok: false, detail: `no start command in the registry for "${service}"` };
  }
  const cwd = tool.cwd ? /*turbopackIgnore: true*/ path.resolve(process.cwd(), tool.cwd) : process.cwd();
  // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true, javascript.lang.security.detect-child-process.detect-child-process -- tool.start is a static command from the curated ports.ts registry and `service` is resolved via toolBySlug (never interpolated into the command), so there is no injection path.
  const child = spawn(tool.start, {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(tool.port) },
    shell: true, // trusted static registry command; single string, no args
  });
  child.unref();
  return { ok: true, detail: `restarted ${service} (pid ${child.pid ?? '?'}) on ${tool.port} — ${tool.start}` };
}

/**
 * Apply a structured repair action. Never throws.
 */
export async function applyRemediationAction(action: IdeRepairAction, workspace: string): Promise<RepairOutcome> {
  const root = workspace || process.cwd();
  switch (action.type) {
    case 'patch':
      if (!action.file || !action.find || action.replace == null) {
        return { ok: false, detail: 'patch action requires file, find, replace' };
      }
      return applyPatch(root, action.file, action.find, action.replace);

    case 'env-set':
      if (!action.key || action.value == null) {
        return { ok: false, detail: 'env-set action requires key and value' };
      }
      return applyEnvSet(root, action.envFile, action.key, action.value);

    case 'command':
      return runRawCommand(action.dir ? /*turbopackIgnore: true*/ path.resolve(process.cwd(), action.dir) : root, action.args ?? []).then((r) => ({
        ok: r.success,
        detail: `${r.command} → ${r.success ? 'ok' : r.error ?? 'failed'}${r.output ? `\n${r.output.split('\n').slice(-3).join('\n').slice(0, 300)}` : ''}`,
      }));

    case 'preset': {
      if (!action.preset) return { ok: false, detail: 'preset action requires a preset' };
      const r = await runWorkspaceCommand(action.dir ? /*turbopackIgnore: true*/ path.resolve(process.cwd(), action.dir) : root, action.preset as CommandPreset);
      return { ok: r.success, detail: `${action.preset} → ${r.success ? 'ok' : r.error ?? 'failed'}${r.output ? `\n${r.output.split('\n').slice(-3).join('\n').slice(0, 300)}` : ''}` };
    }

    case 'restart':
      if (!action.service) return { ok: false, detail: 'restart action requires a service slug' };
      return restartService(action.service);

    default:
      return { ok: false, detail: `unknown repair action type` };
  }
}
