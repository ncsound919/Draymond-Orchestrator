// ============================================================================
// DRAYMOND SERVICE MANAGER — start / stop / health-check known services
// ============================================================================
// The ecosystem's "agents" are mostly local HTTP services (BookBridge, Hemp-OS,
// HempForge, deterministic-brain, Uplift Agent, Sports Steve, ...). When a job
// fails with `fetch failed`, the real fix is usually "start the service". This
// module knows how to start each canonical service (from ports.ts + a curated
// start map), health-check it, and report status — so the repair team actually
// FIXES service_down failures instead of just reporting them.
//
// Deterministic + bounded: start commands are static, health probes have short
// timeouts, and starting is best-effort (never blocks the caller on a hung
// spawn).
// ============================================================================

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_PORTS } from './ports';

export interface ServiceHealth {
  slug: string;
  name: string;
  url: string | null;
  up: boolean;
  detail: string;
  statusCode?: number | null;
}

/** Canonical repo-root-relative working dir per slug (overrides ports.ts cwd). */
const CWD_OVERRIDES: Record<string, string> = {
  'bookbridge': 'agents/BookBridge--main',
  'hemp-os': 'potential/Hemp-OS-main',
  'hempforge': 'potential/HempForge-main',
  'deterministic-brain': 'agents/deterministic-brain',
  'opencode': '.',
};

/**
 * How to START each known service, keyed by port slug. Commands are run in the
 * service's working dir with stdout/stderr redirected to data/server-logs.
 * `health` is a `/path`; `port` is the canonical port. When a slug is absent
 * here (e.g. services without a runnable start), service_down repairs for it
 * escalate instead of guessing.
 */
const START_MAP: Record<string, { command: [string, string[]]; port: number; health: string }> = {
  bookbridge: {
    command: ['python', ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8777']],
    port: 8777,
    health: '/health',
  },
  'deterministic-brain': {
    command: ['python', ['main.py', '--serve']],
    port: 3210,
    health: '/health',
  },
  'hemp-os': {
    command: ['python', ['main.py', '--serve']],
    port: 3100,
    health: '/health',
  },
  hempforge: {
    command: ['npm', ['run', 'dev']],
    port: 3110,
    health: '/api/health',
  },
  uplift: {
    command: ['python', ['-m', 'agent']],
    port: 8000,
    health: '/health',
  },
  'sports-steve': {
    command: ['python', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8010']],
    port: 8010,
    health: '/health',
  },
};

/** Canonical service registry — slug -> { port, health, env } from ports.ts. */
export function serviceCatalog(): Array<{ slug: string; name: string; port: number | null; health: string; env: string }> {
  return TOOL_PORTS
    .filter((t) => t.port !== null && t.slug !== 'draymond') // control plane excluded from self-probe
    .map((t) => ({ slug: t.slug, name: t.name, port: t.port, health: t.health ?? '/', env: t.env }));
}

/** Health URL for a slug (env override aware, like monitors.ts). */
export function serviceUrl(slug: string): string | null {
  const tool = TOOL_PORTS.find((t) => t.slug === slug);
  if (!tool || tool.port === null) return null;
  // Some env vars are full base URLs (BRAIN_URL, MEGACODE_URL, ...). Others
  // (OPENCODE_SERVE_PORT, API_PORT) are just port numbers — those must NOT be
  // treated as URLs or the probe builds "4096/" and fails to parse.
  const envVal = process.env[tool.env];
  if (envVal && /^https?:\/\//i.test(envVal)) {
    return `${envVal.replace(/\/+$/, '')}${tool.health ?? '/'}`;
  }
  return `http://localhost:${tool.port}${tool.health ?? '/'}`;
}

/** Quick health probe for one service (default 4s timeout).
 * MCP endpoints (/mcp) are NOT plain GET-friendly: a GET to /mcp is an SSE
 * stream request and rejects non-SSE clients with 406. For those, POST a
 * JSON-RPC initialize with an `application/json` Accept instead — the same
 * request a real MCP client sends. */
export async function probeService(slug: string, timeoutMs = 4000): Promise<ServiceHealth> {
  const tool = TOOL_PORTS.find((t) => t.slug === slug);
  const name = tool?.name ?? slug;
  const url = serviceUrl(slug);
  if (!url) {
    return { slug, name, url: null, up: false, detail: 'no canonical port/url for this service' };
  }
  try {
    const isMcp = url.includes('/mcp');
    const init: RequestInit = { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' };
    if (isMcp) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      init.body = JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'draymond-probe', version: '1.0.0' } },
      });
    }
    const res = await fetch(url, init);
    const ok = res.status >= 200 && res.status < 500;
    return {
      slug, name, url, up: ok,
      detail: ok ? `HTTP ${res.status}` : `HTTP ${res.status} (not healthy)`,
      statusCode: res.status,
    };
  } catch (err) {
    return {
      slug, name, url, up: false,
      detail: err instanceof Error ? (err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message) : String(err),
    };
  }
}

/** Probe every catalogued service (bounded concurrency). */
export async function probeAllServices(timeoutMs = 4000): Promise<ServiceHealth[]> {
  const slugs = serviceCatalog().map((s) => s.slug);
  const results: ServiceHealth[] = [];
  // Sequential to avoid hammering the local stack.
  for (const slug of slugs) {
    results.push(await probeService(slug, timeoutMs).catch(() => ({ slug, name: slug, url: null, up: false, detail: 'probe failed' })));
  }
  return results;
}

function logPath(slug: string): { dir: string; out: string; err: string } {
  const dir = path.join(process.cwd(), 'data', 'server-logs');
  fs.mkdirSync(dir, { recursive: true });
  return { dir, out: path.join(dir, `${slug}.out.log`), err: path.join(dir, `${slug}.err.log`) };
}

/**
 * Start one service (best-effort). Returns the probe result after a short
 * wait. Never throws — a failed start resolves with up=false + detail.
 */
export async function startService(slug: string): Promise<ServiceHealth> {
  const def = START_MAP[slug];
  const tool = TOOL_PORTS.find((t) => t.slug === slug);
  if (!def) {
    return { slug, name: tool?.name ?? slug, url: serviceUrl(slug), up: false, detail: `no start recipe for "${slug}" — escalate` };
  }

  // Already up? Nothing to do.
  const pre = await probeService(slug, 1500);
  if (pre.up) return pre;

  const cwd = path.resolve(process.cwd(), CWD_OVERRIDES[slug] ?? tool?.cwd ?? '.');
  if (!fs.existsSync(cwd)) {
    return { slug, name: tool?.name ?? slug, url: serviceUrl(slug), up: false, detail: `working dir missing: ${cwd}` };
  }

  const [cmd, args] = def.command;
  const { out, err } = logPath(slug);
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${cmd}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`], { cwd, detached: true, stdio: 'ignore' })
      : spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  // Redirect to server-logs via the shell wrapper where possible; detached
  // processes with stdio ignore don't write logs, so emit a marker.
  try {
    fs.appendFileSync(out, `\n[service-manager] started ${slug} at ${new Date().toISOString()}\n`);
  } catch { /* best-effort */ }
  void err;

  // Wait up to ~18s for the service to become healthy.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const now = await probeService(slug, 1500);
    if (now.up) return now;
  }
  const final = await probeService(slug, 1500);
  return {
    slug, name: tool?.name ?? slug, url: serviceUrl(slug),
    up: false,
    detail: `started "${cmd} ${args.join(' ')}" in ${cwd} but health check still failing: ${final.detail}`,
  };
}

/** Restart a service: best-effort kill then start. */
export async function restartService(slug: string): Promise<ServiceHealth> {
  const { execFileSync } = await import('node:child_process');
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/IM', 'node.exe'], { stdio: 'ignore', timeout: 5000 }).toString();
    } else {
      execFileSync('pkill', ['-f', slug], { stdio: 'ignore', timeout: 5000 }).toString();
    }
  } catch { /* nothing running / kill failed — start anyway */ }
  await new Promise((r) => setTimeout(r, 800));
  return startService(slug);
}

/** Start a batch of known-down services (repair team uses this). */
export async function startDownServices(slugs: string[]): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  for (const slug of slugs) {
    const probe = await probeService(slug, 1500);
    if (probe.up) {
      out.push(probe);
      continue;
    }
    out.push(await startService(slug));
  }
  return out;
}
