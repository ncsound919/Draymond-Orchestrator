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

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_PORTS } from './ports';

// -- Locally-spawned process registry ----------------------------------------
// startService() spawns detached processes. With no record of what we started
// there is no way to CLOSE them — so every repair/cron that "calls up a tool"
// leaked an orphan (the runaway agent/dev-server tree this module now closes).
// Disk-backed so a Draymond restart can still reclaim what it launched.
const PID_REGISTRY = (): string => path.join(process.cwd(), 'data', 'server-pids.json');

interface StartedService {
  slug: string;
  pid: number;
  startedAt: string;
  cwd: string;
  command: string;
}

function readPidRegistry(): Record<string, StartedService> {
  try {
    return JSON.parse(fs.readFileSync(PID_REGISTRY(), 'utf-8')) as Record<string, StartedService>;
  } catch {
    return {};
  }
}

function writePidRegistry(reg: Record<string, StartedService>): void {
  try {
    fs.mkdirSync(path.dirname(PID_REGISTRY()), { recursive: true });
    fs.writeFileSync(PID_REGISTRY(), JSON.stringify(reg, null, 2));
  } catch {
    /* best-effort */
  }
}

function recordStarted(slug: string, pid: number, cwd: string, command: string): void {
  if (!pid) return;
  const reg = readPidRegistry();
  reg[slug] = { slug, pid, startedAt: new Date().toISOString(), cwd, command };
  writePidRegistry(reg);
}

function clearStarted(slug: string): void {
  const reg = readPidRegistry();
  if (!(slug in reg)) return;
  delete reg[slug];
  writePidRegistry(reg);
}

/** Is a tracked PID still alive? (signal 0 = existence probe, no delivery.) */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
  'hemp-os': '../potential/Hemp-OS-main',
  'hempforge': '../02_Pillars/Overlay Science/Biotech/HempForge-main',
  'deterministic-brain': 'agents/deterministic-brain',
  'opencode': '.',
  'sports-steve': 'agents/Sports-Steve-main',
  'social-media-dashboard': 'agents/Social-Media-Dashboard--main',
  'mutly': 'agents/Mutly-Daemon-Agent',
  'uplift-agent': 'agents/Uplift-Agent',
  // OmniResearch: PM2 owns the REAL app (OmniResearch-Pro-main/server.ts).
  // This override previously pointed at agents/OmniResearch-Replacement — an
  // 8KB stub that repaired-into a port conflict with the live service.
  // Health probes resolve via TOOL_PORTS slug; no local start override needed.
  'phoenix': '../04_Integrations/integrations/phoenix',
  'generative-video-ai': '../04_Integrations/integrations/Generative-Video-AI',
  'open-notebook': '../04_Integrations/integrations/open-notebook',
  'stirling-pdf': '../04_Integrations/integrations/Stirling-PDF',
  'litellm': '../04_Integrations/integrations/litellm',
  'tap919-middleman': '../06_Resources/tap919-middleman-main',
  'big-homie': 'agents/AgentBrowser-main/Big-Homie-main',
  'vibe-reality': 'agents/Vibe-Reality-main',
  'sub-team': 'agents/Sub-Team-main',
  'recourse': 'agents/recourse',
};

/**
 * How to START each known service, keyed by port slug. Commands are run in the
 * service's working dir with stdout/stderr redirected to data/server-logs.
 * `health` is a `/path`; `port` is the canonical port. When a slug is absent
 * here (e.g. services without a runnable start), service_down repairs for it
 * escalate instead of guessing.
 */
const START_MAP: Record<string, { command: [string, string[]]; port: number; health: string; env?: Record<string, string> }> = {
  bookbridge: {
    command: ['python', ['main.py']],
    port: 8777,
    health: '/health',
  },
  'omni-research': {
    command: ['python', ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '3010']],
    port: 3010,
    health: '/api/health',
  },
  'deterministic-brain': {
    // Full boot (soul + learning loop + cron chains + KAIROS + swarm worker +
    // server). main.py --serve only runs the API — the brain's own automation
    // (26 cron chains from skill_chains.yaml) would never fire. Canonical port
    // is 3210 (ports.ts); PM2 owns it under ecosystem.brain.config.js, so a
    // service-manager start is only a fallback when PM2 is down.
    command: ['python', ['startup.py']],
    port: 3210,
    health: '/health',
    env: { API_PORT: '3210', UVICORN_WORKERS: '1' },
  },
  'hemp-os': {
    command: ['node', ['--import', 'tsx', 'server.ts']],
    port: 3100,
    health: '/health',
  },
  opencode: {
    // Managed by PM2 (ecosystem.marketing.config.js) — headless codegen server.
    // The service-manager probes health but never spawns it.
    command: ['node', [path.join('node_modules', 'opencode-ai', 'bin', 'opencode'), 'serve', '--port', '4096']],
    port: 4096,
    health: '/',
  },
  hempforge: {
    command: ['npm', ['run', 'dev']],
    port: 3110,
    health: '/api/health',
  },
  'uplift-agent': {
    command: ['node', ['server.js']],
    port: 8000,
    health: '/health',
  },
  'sports-steve': {
    command: ['python', ['-m', 'uvicorn', 'src.main:app', '--host', '127.0.0.1', '--port', '8010']],
    port: 8010,
    health: '/api/v1/health',
  },
  'social-media-dashboard': {
    // Managed by PM2 (ecosystem.marketing.config.js) — remote backends,
    // survives reboots. This entry is a no-op: the port probe still reports
    // health, but the service-manager never spawns it.
    command: ['python', ['-m', 'uvicorn', 'src.ai.api:app', '--host', '127.0.0.1', '--port', '8030']],
    port: 8030,
    health: '/api/ai/health',
  },
  'tap919-middleman': {
    // Metered agent gateway (E3 cash register). Budget-engine meter.ts
    // emits UsageEvents to /internal/execute when MIDDLEMAN_URL is set.
    command: ['python', ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8021']],
    port: 8021,
    health: '/internal/ping',
  },
  'mutly': {
    command: ['npm', ['run', 'dev']],
    port: 4000,
    health: '/api/health',
  },
  'grader': {
    command: ['npm', ['run', 'dev']],
    port: 3201,
    health: '/api/health',
  },
  'agent-browser': {
    command: ['npm', ['run', 'dev', '--', '-p', '3700']],
    port: 3700,
    health: '/api/health',
  },
  'claw-protect': {
    command: ['npm', ['run', 'dev']],
    port: 3300,
    health: '/api/health',
    env: { CLAW_PORT: '3300', CLAW_SERVE_SAAS: 'false' },
  },
  'system-agent': {
    command: ['node', [path.join('node_modules', '.bin', 'tsx'), 'src/server.ts']],
    port: 3405,
    health: '/api/health',
    env: { SYSTEM_AGENT_PORT: '3405' },
  },
  'cai': {
    // CAI is Unix-only (termios REPL). Run via the WSL Ubuntu venv (native-fs ~/.venvs/cai-wsl, git source ~/cai-src).
    // Installed: uv pip install --python ~/.venvs/cai-wsl/bin/python -e ~/cai-src
    command: ['wsl', ['bash', '-lc', 'export PATH="$HOME/.local/bin:$PATH"; export CAI_TRACING=false; export CAI_DISABLE_USAGE_TRACKING=true; cd ~/cai-src && ~/.venvs/cai-wsl/bin/cai run']],
    port: 3303,
    health: '/health',
    env: { CAI_AGENT_TYPE: 'one_tool_agent', CAI_MODEL: 'alias1' },
  },
  'codenexus': {
    command: ['npm', ['run', 'dev']],
    port: 3205,
    health: '/health',
  },
  'big-homie': {
    // FastAPI web server (big_homie_web.py) — task supervision / QA harness.
    // Binds 8888 (config.py server_port); /tools/status is the status endpoint.
    command: ['python', ['big_homie_web.py']],
    port: 8888,
    health: '/tools/status',
  },
  'vibe-reality': {
    // Gemini "reality-check" repo auditor. VIBE_REALITY_LOCAL=1 skips Firebase
    // auth for fleet-internal scoring (production path still requires idToken).
    command: ['node', ['--import', 'tsx', 'server.ts']],
    port: 3202,
    health: '/api/health',
    env: { PORT: '3202', VIBE_REALITY_LOCAL: '1' },
  },
  'cureforge': {
    command: ['npm', ['run', 'dev']],
    port: 3060,
    health: '/api/health',
  },
  'sub-team': {
    command: ['python', ['main.py', '--serve', '--port', '8050', '--host', '0.0.0.0']],
    port: 8050,
    health: '/health',
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  },
  'lil-homie': {
    // Nanobot gateway. Honest gate: no provider/channel config → nanobot
    // gateway exits immediately. canStartService only gates on the dir, so this
    // recipe surfaces an explicit "started but unhealthy" instead of a silent
    // dead process when config is missing.
    command: ['nanobot', ['gateway']],
    port: 18790,
    health: '/',
  },
  'bbtech-web-app': {
    command: ['npm', ['run', 'dev']],
    port: 3061,
    health: '/health',
  },
  'paperclip': {
    command: ['pnpm', ['dev']],
    port: 3705,
    health: '/health',
  },
  'phoenix': {
    command: ['python', ['-m', 'phoenix.server.main', 'serve', '--port', '6006']],
    port: 6006,
    health: '/health',
    env: { PHOENIX_PORT: '6006' },
  },
  'generative-video-ai': {
    command: ['npm', ['run', 'dev', '--', '-p', '8055']],
    port: 8055,
    health: '/',
  },
  'open-notebook': {
    command: ['python', ['-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '3030']],
    port: 3030,
    health: '/',
  },
  'stirling-pdf': {
    command: ['docker', ['run', '-d', '-p', '8080:8080', 'frooodle/s-pdf:latest']],
    port: 8080,
    health: '/',
  },
  'litellm': {
    command: ['litellm', ['--config', 'litellm.yaml', '--port', '4100']],
    port: 4100,
    health: '/health',
    env: { LITELLM_PORT: '4100' },
  },
  'recourse': {
    // Autonomous self-developing architecture OS (template-driven component
    // building, sandboxed-verified tool registry, self-healing repair, dream
    // engine, recursive-math loops). Production build via `npm run build`.
    command: ['node', ['dist/server.cjs']],
    port: 3050,
    health: '/api/recourse/status',
    env: { PORT: '3050', NODE_ENV: 'production' },
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
 * Resolve a bare executable name (python, node, npm, ...) to its real path on
 * Windows. `where.exe` finds .exe/.cmd/.bat; a .cmd shim (npm/npx) is NOT a
 * valid Win32 application for spawn(), so those keep the cmd.exe fallback.
 */
function resolveWin32Executable(name: string): string | null {
  try {
    const result = execFileSync('where.exe', [name], { encoding: 'utf8', timeout: 5000 });
    const first = result.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first && first.length > 0 ? first : null;
  } catch {
    return null;
  }
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

  const cwd = /*turbopackIgnore: true*/ path.resolve(process.cwd(), CWD_OVERRIDES[slug] ?? tool?.cwd ?? '.');
  if (!fs.existsSync(cwd)) {
    return { slug, name: tool?.name ?? slug, url: serviceUrl(slug), up: false, detail: `working dir missing: ${cwd}` };
  }

  const [cmd, args] = def.command;
  const { out, err } = logPath(slug);
  const env = def.env ? { ...process.env, ...def.env } : process.env;

  // Resolve the real executable. `cmd` may be a bare name (python, npm, node)
  // — spawn it directly on Windows instead of wrapping in cmd.exe, which
  // mis-parses `"python"` when the arg string is passed through /c.
  let child: import('node:child_process').ChildProcess;
  if (process.platform === 'win32') {
    const resolvedExe = resolveWin32Executable(cmd);
    if (resolvedExe && /\.exe$/i.test(resolvedExe)) {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- resolvedExe/args come from the curated service recipe registry, not request input.
      child = /*turbopackIgnore: true*/ spawn(resolvedExe, args, { cwd, detached: true, stdio: 'ignore', env });
    } else {
      // npm/npx/opencode are .cmd shims — fall back to cmd.exe /c for those.
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- cmd/args come from the curated service recipe registry, not request input.
      child = spawn('cmd.exe', ['/d', '/s', '/c', `${cmd} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`], { cwd, detached: true, stdio: 'ignore', env });
    }
  } else {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- cmd/args come from the curated service recipe registry, not request input.
    child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', env });
  }
  child.unref();
  // Track what we launched so it can be CLOSED again (stopService). Without
  // this the process is unreachable and runs forever after the job is done.
  if (child.pid) recordStarted(slug, child.pid, cwd, `${cmd} ${args.join(' ')}`);
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

/**
 * Close a service that this module started (the "call up / close" pair).
 *
 * Kills ONLY the recorded process tree — `taskkill /PID <pid> /T /F` on
 * Windows, a process-group signal elsewhere — then falls back to a sticky pm2
 * stop when the slug is pm2-owned. It never kills by image name.
 *
 * (The previous restart path ran `taskkill /F /IM node.exe`, which killed the
 * pm2 daemon, Draymond itself, and every other Node service on the machine.)
 */
export async function stopService(slug: string): Promise<ServiceHealth> {
  const tool = TOOL_PORTS.find((t) => t.slug === slug);
  const name = tool?.name ?? slug;
  const entry = readPidRegistry()[slug];
  let detail = '';

  if (entry && isPidAlive(entry.pid)) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { stdio: 'ignore', timeout: 8000 });
      } else {
        try {
          process.kill(-entry.pid, 'SIGTERM');
        } catch {
          process.kill(entry.pid, 'SIGTERM');
        }
      }
      detail = `closed tracked "${entry.command}" (pid ${entry.pid})`;
    } catch (err) {
      detail = `failed to close pid ${entry.pid}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  clearStarted(slug);

  // pm2-owned service? stop it sticky (autorestart will not resurrect it).
  try {
    const { pm2IsOnline, pm2Stop } = await import('./pm2');
    if (await pm2IsOnline(slug)) {
      const ok = await pm2Stop(slug);
      if (ok) {
        detail = detail ? `${detail}; pm2 stop ${slug}` : `pm2 stop ${slug}`;
      }
    }
  } catch {
    /* pm2 optional */
  }

  if (!detail) detail = 'nothing tracked or running for this slug';
  const post = await probeService(slug, 1500);
  return { ...post, name, detail };
}

/** Close a batch of services (symmetry with startDownServices). */
export async function stopServices(slugs: string[]): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  for (const slug of slugs) out.push(await stopService(slug));
  return out;
}

/** Restart a service: close the one we started, then start fresh. */
export async function restartService(slug: string): Promise<ServiceHealth> {
  await stopService(slug);
  await new Promise((r) => setTimeout(r, 800));
  return startService(slug);
}

/** True when a service has a start recipe AND its working dir exists locally
 * AND its deps are installed (node_modules for npm/pnpm runs). Guards the
 * repair team against wasting start attempts on services that can never boot
 * here (no checkout, no recipe, missing deps). */
export function canStartService(slug: string): boolean {
  const def = START_MAP[slug];
  if (!def) return false;
  const tool = TOOL_PORTS.find((t) => t.slug === slug);
  const cwd = /*turbopackIgnore: true*/ path.resolve(process.cwd(), CWD_OVERRIDES[slug] ?? tool?.cwd ?? '.');
  if (!fs.existsSync(cwd)) return false;
  const [cmd] = def.command;
  // npm/pnpm/pnpx/npx/npm run need installed deps to boot.
  if (cmd === 'npm' || cmd === 'pnpm' || cmd === 'pnpx' || cmd === 'npx') {
    return fs.existsSync(path.join(cwd, 'node_modules'));
  }
  return true;
}

/** Down services that can actually be started locally (repair candidates). */
export function startableDownServices(slugs: string[]): string[] {
  return slugs.filter(canStartService);
}

/** Start a batch of known-down services (repair team uses this).
 * Services that are already up are reported as-is; only startable ones are
 * spawned. Unstartable slugs are reported without burning a start attempt. */
export async function startDownServices(slugs: string[]): Promise<ServiceHealth[]> {
  const out: ServiceHealth[] = [];
  for (const slug of slugs) {
    const probe = await probeService(slug, 1500);
    if (probe.up) {
      out.push(probe);
      continue;
    }
    if (!canStartService(slug)) {
      const tool = TOOL_PORTS.find((t) => t.slug === slug);
      out.push({
        slug, name: tool?.name ?? slug, url: serviceUrl(slug), up: false,
        detail: 'no startable local recipe/checkout — escalate',
      });
      continue;
    }
    out.push(await startService(slug));
  }
  return out;
}
