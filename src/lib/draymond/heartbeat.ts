// ============================================================================
// DRAYMOND AGENT HEARTBEAT SWEEP — liveness for the whole fleet
// ============================================================================
// Every registered agent/tool in the roster is expected to answer a health
// probe. This module pings each catalogued service (ports.ts) and records the
// outcome so the dashboard/roster reflects REAL liveness instead of a static
// "unknown" forever. Down agents are flagged for the repair team.
//
// Written to the file-based registry (.draymond/registry.json) via agent-store
// so status survives restarts (the old /api/v1/worker/heartbeat was in-memory
// only and lost on reboot).
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { probeAllServices } from './service-manager';
import { getAllAgents, updateAgentStatus } from '@/lib/registry/agent-store';

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
const HEARTBEAT_FILE = path.join(DIR, 'heartbeats.json');

export interface HeartbeatRecord {
  slug: string;
  name: string;
  last_seen: string;
  up: boolean;
  detail: string;
}

async function readHeartbeats(): Promise<Record<string, HeartbeatRecord>> {
  try {
    const raw = await fs.readFile(HEARTBEAT_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, HeartbeatRecord>;
  } catch {
    return {};
  }
}

/** Map a registry agent's slug/endpoint to its canonical service slug. */
function agentServiceSlug(agentSlug: string): string {
  const map: Record<string, string> = {
    'uplift-agent': 'uplift',
    'sports-steve': 'sports-steve',
    'omniresearch-pro': 'omniresearch-pro',
    'bookbridge': 'bookbridge',
    'hemp-os': 'hemp-os',
    'hempforge': 'hempforge',
    'kaggle': 'deterministic-brain',
    'deterministic-brain': 'deterministic-brain',
    'agent-browser': 'agent-browser',
    'big-homie': 'big-homie',
    'cai': 'cai',
    'codenexus': 'codenexus',
    'cureforge': 'cureforge',
    'paperclip': 'paperclip',
    'bbtech-web-app': 'bbtech-web-app',
    'mutly': 'mutly',
    'megacode': 'megacode',
    'opencode': 'opencode',
    'social-media-dashboard': 'social-media-dashboard',
    'indy-music-platform': 'indy-music',
    'overlay-chain': 'overlay-chain',
  };
  return map[agentSlug] ?? agentSlug;
}

/**
 * Sweep the fleet: probe every catalogue service, write heartbeats, and update
 * each roster agent's status (online/offline) in the file registry.
 * Best-effort: a probe failure never throws.
 */
export async function runHeartbeatSweep(): Promise<{
  checked: number;
  up: number;
  down: string[];
  recorded: number;
}> {
  const [agents, services] = await Promise.all([
    getAllAgents().catch(() => []),
    probeAllServices().catch(() => []),
  ]);
  const byService = new Map(services.map((s) => [s.slug, s]));
  const heartbeats = await readHeartbeats();
  let recorded = 0;

  for (const agent of agents) {
    const serviceSlug = agentServiceSlug(agent.slug);
    const svc = byService.get(serviceSlug);
    if (!svc) continue; // no canonical probe for this agent — leave status as-is
    const rec: HeartbeatRecord = {
      slug: agent.slug,
      name: agent.name,
      last_seen: new Date().toISOString(),
      up: svc.up,
      detail: svc.detail,
    };
    heartbeats[agent.slug] = rec;
    recorded++;
    try {
      await updateAgentStatus(agent.id ?? agent.slug, svc.up ? 'online' : 'offline');
    } catch { /* registry write best-effort */ }
  }

  // Persist heartbeat file.
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(HEARTBEAT_FILE, JSON.stringify(heartbeats, null, 2), 'utf-8');
  } catch { /* best-effort */ }

  const up = services.filter((s) => s.up).length;
  const down = services.filter((s) => !s.up).map((s) => s.slug);
  return { checked: services.length, up, down, recorded };
}

/** Latest recorded heartbeats (for /api/ops/heartbeats). */
export async function getHeartbeats(): Promise<Record<string, HeartbeatRecord>> {
  return readHeartbeats();
}
