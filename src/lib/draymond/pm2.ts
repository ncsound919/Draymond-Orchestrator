// ============================================================================
// PM2 WRAPPER — thin, deterministic binding to the global pm2 daemon
// ============================================================================
// The fleet is pm2-managed (fleet-manifest.js → ecosystem.*.config.js). pm2 is
// installed globally (not a local dep), so this wrapper shells to the pm2 CLI
// and parses `jlist` JSON. It is deliberately thin: it owns start/stop/status
// so the Sector Lifecycle Manager can treat pm2 as the SINGLE owner of a
// process's lifecycle (stop is sticky — autorestart never resurrects a stopped
// process). If pm2 is ever added as a local dependency, swap these for the
// `require('pm2')` programmatic API — the signatures are kept compatible.
//
// Bounded + best-effort: every call has a short timeout, never throws (returns
// false / empty on failure) so the scheduler can degrade instead of stalling.
// ============================================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface Pm2Process {
  name: string;
  status: string; // 'online' | 'stopped' | 'errored' | 'waiting restart' | ...
  pid: number;
  restarts: number;
  memoryBytes?: number;
}

function pm2Bin(): string {
  return process.env.PM2_BIN || 'pm2';
}

/** Run a pm2 CLI command. Resolves { ok, stdout } — never throws. */
async function run(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string }> {
  try {
    const bin = pm2Bin();
    // On Windows pm2 is a `.cmd` shim that execFile cannot spawn directly —
    // route it through cmd.exe /c (mirrors the service-manager's win32 path).
    const useCmd = process.platform === 'win32';
    const execBin = useCmd ? 'cmd.exe' : bin;
    const execArgs = useCmd ? ['/d', '/s', '/c', [bin, ...args].join(' ')] : args;
    const { stdout } = await execFileP(execBin, execArgs, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      // pm2 jlist can be large (full env dump per process).
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout || '' };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/**
 * Snapshot every pm2 process as a name → process map. Returns an empty map on
 * any failure so callers never crash on a pm2 hiccup.
 */
export async function pm2List(): Promise<Map<string, Pm2Process>> {
  const { ok, stdout } = await run(['jlist'], 15_000);
  if (!ok || !stdout) return new Map();
  try {
    const arr: unknown = JSON.parse(stdout);
    if (!Array.isArray(arr)) return new Map();
    const map = new Map<string, Pm2Process>();
    for (const p of arr) {
      const rec = p as {
        name?: string;
        pid?: number;
        status?: string;
        pm2_env?: { status?: string; restart_time?: number };
        monit?: { memory?: number };
        restart_time?: number;
      };
      const name = rec?.name;
      if (!name) continue;
      const status = rec.pm2_env?.status ?? rec.status ?? 'unknown';
      const restarts = rec.pm2_env?.restart_time ?? rec.restart_time ?? 0;
      map.set(name, {
        name,
        status,
        pid: rec.pid ?? 0,
        restarts,
        memoryBytes: rec.monit?.memory,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Is a process online right now? */
export async function pm2IsOnline(name: string): Promise<boolean> {
  const list = await pm2List();
  const p = list.get(name);
  return !!p && p.status === 'online';
}

/** Stop a process by name (sticky — autorestart will NOT bring it back). */
export async function pm2Stop(name: string): Promise<boolean> {
  return (await run(['stop', name], 20_000)).ok;
}

/**
 * Start a process by name. Only works for processes already registered with
 * the pm2 daemon (e.g. previously started via an ecosystem config + `pm2 save`).
 * Prefer pm2StartConfig for a first/never-booted boot.
 */
export async function pm2StartByName(name: string): Promise<boolean> {
  return (await run(['start', name], 30_000)).ok;
}

/**
 * Start a single app from an ecosystem config: `pm2 start <config> --only <name>`.
 * This is the robust path for on-demand cold-start of a service that may never
 * have been booted on this daemon. configPath is the ecosystem config file.
 */
export async function pm2StartConfig(configPath: string, name: string): Promise<boolean> {
  return (await run(['start', configPath, '--only', name], 30_000)).ok;
}

/** Restart a process by name. */
export async function pm2Restart(name: string): Promise<boolean> {
  return (await run(['restart', name], 20_000)).ok;
}
