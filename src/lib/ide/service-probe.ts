// ============================================================================
// DRAYMOND AGENT IDE — service probe (ops diagnostics)
// ============================================================================
// Gives the repair team eyes on a running (or dead) service: is the port open,
// does the health endpoint answer, what does the recent log say, are required
// env vars set? Combines that into a failure signature the repair playbook can
// match. Docker-free — pure HTTP + TCP + local log reads.
// ============================================================================

import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { toolBySlug, toolHealthUrl } from '../draymond/ports';

export type FailureSignature =
  | 'healthy'
  | 'reachable'
  | 'unreachable'
  | 'wrong_port'
  | 'crash_loop'
  | 'missing_deps'
  | 'missing_env'
  | 'port_conflict'
  | 'prisma_uninit'
  | 'spawn_einval'
  | 'workspace_ref'
  | 'not_started'
  | 'unknown';

export interface ServiceDiagnosis {
  slug: string;
  port: number | null;
  listening: boolean;
  httpCode: number | null;
  healthUrl: string | null;
  logTail: string[];
  missingEnv: string[];
  signature: FailureSignature;
  notes: string[];
}

const SIGNATURE_PATTERNS: Array<{ signature: FailureSignature; re: RegExp }> = [
  { signature: 'port_conflict', re: /EADDRINUSE|Port \d+ is already in use|address already in use/i },
  { signature: 'spawn_einval', re: /spawn.*EINVAL|\.cmd.*(EINVAL|ENOENT)/i },
  { signature: 'prisma_uninit', re: /did not initialize yet|run ["']?prisma generate/i },
  { signature: 'missing_deps', re: /Cannot find package|MODULE_NOT_FOUND|ERESOLVE|could not resolve|workspace:\*/i },
  { signature: 'missing_env', re: /Missing required env|environment variable.*required|is required/i },
  { signature: 'workspace_ref', re: /workspace:\*/i },
];

async function portOpen(port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean): void => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

function logDir(): string {
  const base = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
  return path.join(base, '..', 'data', 'server-logs');
}

async function readLogTail(slug: string): Promise<string[]> {
  const out: string[] = [];
  const dir = logDir();
  for (const name of [`${slug}.err.log`, `${slug}.out.log`]) {
    try {
      const raw = await fs.readFile(path.join(dir, name), 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      out.push(...lines.slice(-12));
    } catch {
      // no log file yet
    }
  }
  return out;
}

function classify(slug: string, d: Omit<ServiceDiagnosis, 'signature' | 'notes'>): { signature: FailureSignature; notes: string[] } {
  const notes: string[] = [];
  const logs = d.logTail.join('\n');

  if (d.httpCode != null && d.httpCode >= 200 && d.httpCode < 500) {
    return { signature: 'healthy', notes: [`health endpoint answered HTTP ${d.httpCode}`] };
  }

  for (const { signature, re } of SIGNATURE_PATTERNS) {
    if (re.test(logs)) {
      const m = logs.match(re)?.[0];
      notes.push(m ? `log matches "${m}"` : `log matches ${signature}`);
      return { signature, notes };
    }
  }

  if (d.listening && d.httpCode == null) {
    return { signature: 'reachable', notes: ['port open but health endpoint did not respond'] };
  }
  if (d.listening && d.httpCode != null && d.httpCode >= 500) {
    return { signature: 'crash_loop', notes: [`health endpoint returned HTTP ${d.httpCode}`] };
  }
  if (!d.listening) {
    if (logs.length === 0) return { signature: 'not_started', notes: ['not listening and no recent logs — service likely not started'] };
    return { signature: 'crash_loop', notes: ['not listening, logs present — crashed or failed to bind'] };
  }
  return { signature: 'unknown', notes: [] };
}

/**
 * Probe a service by registry slug. Never throws.
 */
export async function probeService(slug: string, requiredEnv?: string[]): Promise<ServiceDiagnosis> {
  const tool = toolBySlug(slug);
  const port = tool?.port ?? null;
  const healthUrl = toolHealthUrl(slug);

  const listening = port != null ? await portOpen(port) : false;
  let httpCode: number | null = null;
  if (healthUrl) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      httpCode = res.status;
    } catch {
      httpCode = null;
    }
  }
  const logTail = await readLogTail(slug);

  const missingEnv = (requiredEnv ?? []).filter((k) => !process.env[k]);

  const { signature, notes } = classify(slug, { slug, port, listening, httpCode, healthUrl, logTail, missingEnv });
  return { slug, port, listening, httpCode, healthUrl, logTail, missingEnv, signature, notes };
}
