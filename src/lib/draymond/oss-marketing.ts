// ============================================================================
// OSS MARKETING STACK MANAGER — start / stop / health-check the docker-compose
// marketing stack (Shlink, Postiz+Temporal, Listmonk, Twenty, Formbricks) as a
// single team, so Draymond can schedule them within the daily workload.
// ============================================================================
// These services are NOT pm2 apps — they are Docker Compose stacks under
// 04_Integrations/oss-marketing-stack/. Draymond controls them via `docker
// compose`, probes their health via the ports.ts registry, and treats the whole
// stack as one team (up in dependency order, down as a unit, per-service
// status surfaced for monitors + repair).
//
// Deterministic + bounded: compose commands run with short timeouts, health
// probes reuse probeService(), and failures never throw (best-effort, reported).
// ============================================================================

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { probeService } from './service-manager';

const execFileAsync = promisify(execFile);

/** Repo-root-relative dir holding the marketing compose files. */
const OSS_STACK_DIR = path.join('..', '04_Integrations', 'oss-marketing-stack');

export interface OssService {
  slug: string;          // ports.ts slug
  name: string;
  port: number;
  health: string;
  /** docker compose file (relative to OSS_STACK_DIR) + service name. */
  compose: string;
  service: string;       // compose service name to up/down
  startupHint?: string;
}

/** The OSS marketing team — one entry per docker compose service we control. */
export const OSS_MARKETING_TEAM: OssService[] = [
  {
    slug: 'oss-shlink',
    name: 'Shlink',
    port: 8080,
    health: '/rest/v2/health',
    compose: 'docker-compose.yml',
    service: 'shlink',
    startupHint: 'docker compose -f docker-compose.yml up -d',
  },
  {
    slug: 'oss-postiz',
    name: 'Postiz',
    port: 4007,
    health: '/',
    compose: 'postiz.yml',
    service: 'postiz',
    startupHint: 'docker compose -f postiz.yml up -d',
  },
  {
    slug: 'oss-temporal-ui',
    name: 'Temporal UI',
    port: 8090,
    health: '/',
    compose: 'postiz.yml',
    service: 'temporal-ui',
    startupHint: 'docker compose -f postiz.yml up -d',
  },
  {
    slug: 'oss-listmonk',
    name: 'Listmonk',
    port: 9002,
    health: '/',
    compose: 'listmonk.yml',
    service: 'listmonk',
    startupHint: 'docker compose -f listmonk.yml up -d',
  },
  {
    slug: 'oss-twenty',
    name: 'Twenty',
    port: 3001,
    health: '/healthz',
    compose: 'twenty.yml',
    service: 'server',
    startupHint: 'docker compose -f twenty.yml up -d',
  },
  {
    slug: 'oss-formbricks',
    name: 'Formbricks',
    port: 3002,
    health: '/health',
    compose: 'formbricks/docker-compose.yml',
    service: 'formbricks',
    startupHint: 'docker compose -f formbricks/docker-compose.yml up -d',
  },
  {
    slug: 'oss-umami',
    name: 'Umami',
    port: 3003,
    health: '/',
    compose: 'umami.yml',
    service: 'umami',
    startupHint: 'docker compose -f umami.yml up -d',
  },
  {
    slug: 'oss-windmill',
    name: 'Windmill',
    port: 8001,
    health: '/api/version',
    compose: 'windmill.yml',
    service: 'windmill',
    startupHint: 'docker compose -f windmill.yml up -d',
  },
];

/** Absolute path to a compose file for a team member. */
function composePath(member: OssService): string {
  return path.resolve(process.cwd(), OSS_STACK_DIR, member.compose);
}

function runCompose(args: string[], composeFile: string, timeoutMs = 60_000): Promise<{ ok: boolean; detail: string }> {
  return execFileAsync('docker', ['compose', '-f', composeFile, ...args], {
    timeout: timeoutMs,
    cwd: path.resolve(process.cwd(), OSS_STACK_DIR),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  })
    .then(({ stdout, stderr }) => {
      const detail = (stdout + stderr).trim().split(/\r?\n/).slice(-3).join(' | ') || 'ok';
      return { ok: true, detail };
    })
    .catch((err: { message?: string }) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, detail: msg.slice(0, 500) };
    });
}

/** Probe one OSS service via the shared service-manager probe (short timeout). */
export async function ossServiceStatus(slug: string): Promise<{ slug: string; up: boolean; detail: string }> {
  const probe = await probeService(slug, 4000);
  return { slug: probe.slug, up: probe.up, detail: probe.detail };
}

/** Probe the whole marketing team (bounded, sequential). */
export async function ossTeamStatus(): Promise<Array<{ slug: string; name: string; up: boolean; detail: string; port: number }>> {
  const out: Array<{ slug: string; name: string; up: boolean; detail: string; port: number }> = [];
  for (const member of OSS_MARKETING_TEAM) {
    const probe = await probeService(member.slug, 4000);
    out.push({ slug: member.slug, name: member.name, up: probe.up, detail: probe.detail, port: member.port });
  }
  return out;
}

/**
 * Start one compose service (best-effort). `compose up -d` detaches quickly;
 * `waitMs` bounds the health-wait loop only. Default ~3 min per service (Twenty
 * runs DB migrations + 27 cron jobs on boot; Formbricks/Postiz need migrations).
 * Pass a smaller waitMs for bounded callers (e.g. the scheduler job).
 */
export async function ossServiceUp(
  member: OssService,
  waitMs = 180_000
): Promise<{ slug: string; up: boolean; detail: string }> {
  const pre = await probeService(member.slug, 1500);
  if (pre.up) return { slug: member.slug, up: true, detail: 'already up' };
  const res = await runCompose(['up', '-d', member.service], composePath(member));
  if (!res.ok) return { slug: member.slug, up: false, detail: `compose up failed: ${res.detail}` };
  const attempts = Math.max(1, Math.floor(waitMs / 1500));
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const now = await probeService(member.slug, 1500);
    if (now.up) return { slug: member.slug, up: true, detail: `up (${now.detail})` };
  }
  const final = await probeService(member.slug, 1500);
  return { slug: member.slug, up: false, detail: `started compose but health still failing: ${final.detail}` };
}

/**
 * Start the whole team in dependency order (shlink → umami → listmonk → twenty
 * → postiz → formbricks → windmill). `waitMs` bounds the per-service health wait.
 */
export async function ossTeamUp(waitMs = 180_000): Promise<Array<{ slug: string; up: boolean; detail: string }>> {
  const order = ['oss-shlink', 'oss-umami', 'oss-listmonk', 'oss-twenty', 'oss-postiz', 'oss-temporal-ui', 'oss-formbricks', 'oss-windmill'];
  const results: Array<{ slug: string; up: boolean; detail: string }> = [];
  for (const slug of order) {
    const member = OSS_MARKETING_TEAM.find((m) => m.slug === slug);
    if (!member) continue;
    results.push(await ossServiceUp(member, waitMs));
  }
  return results;
}

/** Stop one compose service. */
export async function ossServiceDown(member: OssService): Promise<{ slug: string; stopped: boolean; detail: string }> {
  const res = await runCompose(['stop', member.service], composePath(member));
  const stopped = res.ok;
  return { slug: member.slug, stopped, detail: res.detail };
}

/** Stop the whole team (compose per file, deduplicated). */
export async function ossTeamDown(): Promise<Array<{ slug: string; stopped: boolean; detail: string }>> {
  const results: Array<{ slug: string; stopped: boolean; detail: string }> = [];
  const seenFiles = new Set<string>();
  for (const member of OSS_MARKETING_TEAM) {
    const file = composePath(member);
    if (!seenFiles.has(file)) {
      seenFiles.add(file);
      // Stop the whole compose file's services once (covers postiz + temporal-ui).
      const res = await runCompose(['stop'], file);
      for (const m of OSS_MARKETING_TEAM.filter((x) => composePath(x) === file)) {
        results.push({ slug: m.slug, stopped: res.ok, detail: res.detail });
      }
    }
  }
  return results;
}

/** Team status summary — down services, up services, and total. */
export async function ossTeamSummary(): Promise<{
  checked: number;
  up: number;
  down: string[];
  statuses: Array<{ slug: string; name: string; up: boolean; detail: string; port: number }>;
}> {
  const statuses = await ossTeamStatus();
  const down = statuses.filter((s) => !s.up).map((s) => s.slug);
  return { checked: statuses.length, up: statuses.filter((s) => s.up).length, down, statuses };
}
