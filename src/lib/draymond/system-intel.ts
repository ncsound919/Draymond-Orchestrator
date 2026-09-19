// ============================================================================
// DRAYMOND SYSTEM INTELLIGENCE — the "chat knows the system deeply" layer
// ============================================================================
// Compiles a bounded, structured snapshot of the ENTIRE system from the local
// DB: agents, entities, chains/workflows, scheduled jobs (crons), site
// monitors, notifications, actions, goals (the agenda), memory, events,
// handoffs, benchmarks, the upgrade/repair queue, execution logs, and the
// Graphify knowledge graph (when indexed). The chat feeds this snapshot to the
// LLM so questions about crons, agenda, repairs, and progress are answered
// from real state instead of a shallow dashboard summary.
//
// Pure server-side — no Next request context. Uses the local DB client.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createDraymondAdminClient } from './client';
import type { BrainStatus } from './brain-client';

export interface SystemIntel {
  generated_at: string;
  agents: Array<{ name: string; slug: string; status: string; consecutive_errors: number }>;
  entities: {
    total: number;
    active: number;
    by_kind: Record<string, number>;
    unhealthy: string[];
  };
  chains: {
    total: number;
    by_status: Record<string, number>;
    recent: Array<{ name: string; status: string; started_at: string | null }>;
  };
  jobs: {
    total: number;
    enabled: number;
    failed_recently: Array<{ name: string; last_run_status: string; last_run_at: string | null }>;
    next_up: Array<{ name: string; next_run_at: string | null }>;
  };
  monitors: { total: number; down: string[] };
  notifications: {
    recent: Array<{ type: string; subject: string; status: string }>;
    failed_recently: number;
  };
  actions: {
    by_status: Record<string, number>;
    pending: Array<{ action_type: string; description: string }>;
  };
  goals: { active: Array<{ title: string; progress_pct: number; horizon: string }> };
  memory: { total: number; by_tier: Record<string, number> };
  events: { last_24h: number; recent: Array<{ severity: string; event_type: string; message: string }> };
  handoffs_last_24h: number;
  benchmarks: { latest: Array<{ component_name: string; weakness_score: number; run_at: string | null }> };
  upgrade_queue: { items: Array<{ component_name: string; weakness_score: number; status: string }> };
  execution: {
    recent: Array<{ entity_slug: string; action: string; success: boolean; error_message: string | null }>;
    failed_recently: number;
  };
  repairs: { recent: Array<{ event_type: string; message: string }> };
  knowledge_graph: { indexed: boolean; report_excerpt: string | null };
  /** Deterministic brain observer status (null when BRAIN_URL unset/unreachable). */
  brain: BrainStatus | null;
}

function isRepairEvent(type: string): boolean {
  return /repair|recover|upgrade/i.test(type);
}

function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// -- Graphify knowledge graph (optional; present after `graphify .`) ---------

function loadKnowledgeGraph(): { indexed: boolean; report_excerpt: string | null } {
  try {
    const reportPath = path.join(process.cwd(), 'graphify-out', 'GRAPH_REPORT.md');
    if (!fs.existsSync(reportPath)) return { indexed: false, report_excerpt: null };
    const content = fs.readFileSync(reportPath, 'utf8');
    return { indexed: true, report_excerpt: content.slice(0, 4000) };
  } catch {
    return { indexed: false, report_excerpt: null };
  }
}

// -- Snapshot ----------------------------------------------------------------

/**
 * Build the full system intelligence snapshot. Bounded: recent rows and counts
 * only, so it stays small enough to feed an LLM every turn.
 */
export async function getSystemIntel(): Promise<SystemIntel> {
  const supabase = createDraymondAdminClient();
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    agentsRes,
    entitiesRes,
    chainsRes,
    jobsRes,
    monitorsRes,
    notificationsRes,
    actionsRes,
    goalsRes,
    memoryRes,
    eventsRes,
    eventsCountRes,
    handoffsRes,
    benchmarksRes,
    queueRes,
    execRes,
  ] = await Promise.all([
    supabase.from('draymond_agents').select('name, slug, status, consecutive_errors').order('name'),
    supabase.from('draymond_entities').select('name, kind, health_status, is_active').eq('is_active', true).order('name'),
    supabase.from('draymond_chains').select('name, status, started_at').order('started_at', { ascending: false }).limit(20),
    supabase.from('draymond_scheduled_jobs').select('name, cron_expression, last_run_status, last_run_at, next_run_at, is_enabled').order('name'),
    supabase.from('draymond_site_monitors').select('name, current_status, consecutive_failures, is_enabled').order('name'),
    supabase.from('draymond_notifications').select('type, subject, status, created_at').order('created_at', { ascending: false }).limit(10),
    supabase.from('draymond_actions').select('status, action_type, description, created_at').order('created_at', { ascending: false }).limit(60),
    supabase.from('draymond_goals').select('title, status, progress_pct, horizon').order('created_at').limit(30),
    supabase.from('draymond_memory').select('tier').limit(5000),
    supabase.from('draymond_events').select('severity, event_type, message, created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('draymond_events').select('*', { count: 'exact', head: true }).gte('created_at', dayAgo),
    supabase.from('draymond_handoffs').select('*', { count: 'exact', head: true }).gte('created_at', dayAgo),
    supabase.from('draymond_benchmarks').select('component_name, weakness_score, run_at').order('run_at', { ascending: false }).limit(10),
    supabase.from('draymond_upgrade_queue').select('component_name, weakness_score, status').order('weakness_score', { ascending: false }).limit(10),
    supabase.from('draymond_execution_logs').select('entity_slug, action, success, error_message, created_at').order('created_at', { ascending: false }).limit(20),
  ]);

  const agents = (agentsRes.data ?? []) as SystemIntel['agents'];
  const entities = (entitiesRes.data ?? []) as Array<{ name: string; kind: string; health_status: string }>;
  const chains = (chainsRes.data ?? []) as SystemIntel['chains']['recent'];
  const jobs = (jobsRes.data ?? []) as Array<{ name: string; cron_expression: string; last_run_status: string; last_run_at: string | null; next_run_at: string | null; is_enabled: number }>;
  const monitors = (monitorsRes.data ?? []) as Array<{ name: string; current_status: string; is_enabled: number }>;
  const notifications = (notificationsRes.data ?? []) as Array<{ type: string; subject: string; status: string; created_at: string }>;
  const actions = (actionsRes.data ?? []) as Array<{ status: string; action_type: string; description: string }>;
  const goals = (goalsRes.data ?? []) as Array<{ title: string; status: string; progress_pct: number; horizon: string }>;
  const memory = (memoryRes.data ?? []) as Array<{ tier: string }>;
  const events = (eventsRes.data ?? []) as Array<{ severity: string; event_type: string; message: string }>;
  const benchmarks = (benchmarksRes.data ?? []) as SystemIntel['benchmarks']['latest'];
  const queue = (queueRes.data ?? []) as SystemIntel['upgrade_queue']['items'];
  const execRows = (execRes.data ?? []) as SystemIntel['execution']['recent'];

  const graph = loadKnowledgeGraph();

  // Deterministic brain observer status (lazy + gated on BRAIN_URL).
  let brain: BrainStatus | null = null;
  try {
    const { getBrainStatus } = await import('./brain-client');
    brain = await getBrainStatus();
  } catch {
    brain = null;
  }

  const intel: SystemIntel = {
    generated_at: now,
    agents,
    entities: {
      total: entities.length,
      active: entities.length, // the query already filters is_active = true
      by_kind: countBy(entities, (e) => e.kind),
      unhealthy: entities.filter((e) => e.health_status === 'unhealthy' || e.health_status === 'degraded').map((e) => e.name),
    },
    chains: {
      total: chains.length,
      by_status: countBy(chains, (c) => c.status),
      recent: chains,
    },
    jobs: {
      total: jobs.length,
      enabled: jobs.filter((j) => j.is_enabled).length,
      failed_recently: jobs.filter((j) => j.last_run_status === 'failed').map((j) => ({ name: j.name, last_run_status: j.last_run_status, last_run_at: j.last_run_at })),
      next_up: jobs
        .filter((j) => j.next_run_at)
        .sort((a, b) => (a.next_run_at! < b.next_run_at! ? -1 : 1))
        .slice(0, 5)
        .map((j) => ({ name: j.name, next_run_at: j.next_run_at })),
    },
    monitors: {
      total: monitors.length,
      // Only ENABLED monitors count toward "down" — disabled monitors for
      // services not present on this machine (Bet Buddy, Indy Music, Megacode)
      // must not drive repair escalations / brain decisions forever.
      down: monitors.filter((m) => m.is_enabled && m.current_status === 'down').map((m) => m.name),
    },
    notifications: {
      recent: notifications.map((n) => ({ type: n.type, subject: n.subject, status: n.status })),
      failed_recently: notifications.filter((n) => n.status === 'failed').length,
    },
    actions: {
      by_status: countBy(actions, (a) => a.status),
      pending: actions.filter((a) => a.status === 'pending_review').slice(0, 8).map((a) => ({ action_type: a.action_type, description: a.description })),
    },
    goals: {
      active: goals.filter((g) => g.status === 'active').map((g) => ({ title: g.title, progress_pct: g.progress_pct, horizon: g.horizon })),
    },
    memory: {
      total: memory.length,
      by_tier: countBy(memory, (m) => m.tier),
    },
    events: {
      last_24h: eventsCountRes.count ?? events.length,
      recent: events.slice(0, 12).map((e) => ({ severity: e.severity, event_type: e.event_type, message: e.message })),
    },
    handoffs_last_24h: handoffsRes.count ?? 0,
    benchmarks: {
      latest: benchmarks,
    },
    upgrade_queue: {
      items: queue,
    },
    execution: {
      recent: execRows,
      failed_recently: execRows.filter((r) => !r.success).length,
    },
    repairs: {
      recent: events.filter((e) => isRepairEvent(e.event_type)).slice(0, 8).map((e) => ({ event_type: e.event_type, message: e.message })),
    },
    knowledge_graph: graph,
    brain,
  };

  return intel;
}

// -- Compact text formatter (LLM context + deterministic fallback) -----------

export function formatSystemIntel(intel: SystemIntel): string {
  const lines: string[] = [];

  lines.push(`# Draymond system snapshot (${intel.generated_at})`);

  const degraded = intel.agents.filter((a) => a.status !== 'active');
  lines.push(`\n## Agents (${intel.agents.length})`);
  lines.push(degraded.length === 0
    ? 'All agents active.'
    : `Non-active: ${degraded.map((a) => `${a.name} (${a.status}, ${a.consecutive_errors} errors)`).join(', ')}`);

  lines.push(`\n## Entities (${intel.entities.total} active) by kind: ${Object.entries(intel.entities.by_kind).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (intel.entities.unhealthy.length > 0) lines.push(`Unhealthy: ${intel.entities.unhealthy.join(', ')}`);

  lines.push(`\n## Chains / workflows (recent ${intel.chains.total})`);
  if (intel.chains.recent.length === 0) lines.push('No recent chains.');
  else lines.push(intel.chains.recent.map((c) => `- ${c.name} [${c.status}]`).join('\n'));

  lines.push(`\n## Crons / scheduled jobs (${intel.jobs.total}, ${intel.jobs.enabled} enabled)`);
  if (intel.jobs.failed_recently.length === 0) lines.push('No failing jobs.');
  else lines.push(`Failing: ${intel.jobs.failed_recently.map((j) => j.name).join(', ')}`);
  if (intel.jobs.next_up.length > 0) lines.push(`Next up: ${intel.jobs.next_up.map((j) => `${j.name} @ ${j.next_run_at}`).join(' | ')}`);

  lines.push(`\n## Site monitors (${intel.monitors.total})`);
  lines.push(intel.monitors.down.length === 0 ? 'All up.' : `DOWN: ${intel.monitors.down.join(', ')}`);

  lines.push(`\n## Agenda / goals (${intel.goals.active.length} active)`);
  if (intel.goals.active.length === 0) lines.push('No active goals.');
  else lines.push(intel.goals.active.map((g) => `- ${g.title} (${g.progress_pct}%, ${g.horizon})`).join('\n'));

  lines.push(`\n## Repairs & recovery (recent ${intel.repairs.recent.length})`);
  if (intel.repairs.recent.length === 0) lines.push('No recent repair activity.');
  else lines.push(intel.repairs.recent.map((r) => `- [${r.event_type}] ${r.message.slice(0, 160)}`).join('\n'));

  lines.push(`\n## Upgrade queue (${intel.upgrade_queue.items.length})`);
  if (intel.upgrade_queue.items.length > 0) {
    lines.push(intel.upgrade_queue.items.map((q) => `- ${q.component_name} (weakness ${q.weakness_score}, ${q.status})`).join('\n'));
  }

  lines.push(`\n## Actions`);
  if (intel.actions.pending.length > 0) {
    lines.push(`Pending approval: ${intel.actions.pending.map((a) => a.action_type).join(', ')}`);
  }
  lines.push(`Statuses: ${Object.entries(intel.actions.by_status).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);

  lines.push(`\n## Memory (${intel.memory.total})`);
  lines.push(Object.entries(intel.memory.by_tier).map(([k, v]) => `${k}=${v}`).join(', ') || 'empty');

  lines.push(`\n## Events (last 24h: ${intel.events.last_24h})`);
  lines.push(intel.events.recent.map((e) => `- [${e.severity}] ${e.event_type}: ${e.message.slice(0, 120)}`).join('\n'));

  lines.push(`\n## Progress / benchmarks`);
  if (intel.benchmarks.latest.length > 0) {
    lines.push(intel.benchmarks.latest.map((b) => `- ${b.component_name} (weakness ${b.weakness_score})`).join('\n'));
  }

  lines.push(`\n## Execution (last ${intel.execution.recent.length}, ${intel.execution.failed_recently} failed)`);
  lines.push(intel.execution.recent.slice(0, 8).map((r) => `- ${r.entity_slug}/${r.action} ${r.success ? 'ok' : 'FAILED'}`).join('\n'));

  if (intel.knowledge_graph.indexed && intel.knowledge_graph.report_excerpt) {
    lines.push(`\n## Knowledge graph (graphify)`);
    lines.push(intel.knowledge_graph.report_excerpt.slice(0, 1200));
  }

  if (intel.brain) {
    lines.push(`\n## Deterministic brain`);
    lines.push(`Last sweep: ${intel.brain.last_run_at ?? 'never'} · ${intel.brain.open_findings} open findings · ${intel.brain.total_findings} total`);
    if (intel.brain.last_run?.summary) {
      lines.push(`Latest findings: ${JSON.stringify(intel.brain.last_run.summary).slice(0, 400)}`);
    }
  }

  return lines.join('\n');
}

/** Compact one-liner used for status pills and logs. */
export function systemIntelSummary(intel: SystemIntel): string {
  const badAgents = intel.agents.filter((a) => a.status !== 'active').length;
  const parts = [
    `${intel.agents.length} agents`,
    `${intel.entities.total} entities`,
    `${intel.jobs.failed_recently.length}/${intel.jobs.total} jobs failing`,
    `${intel.monitors.down.length}/${intel.monitors.total} monitors down`,
    `${intel.goals.active.length} active goals`,
    `${intel.repairs.recent.length} recent repairs`,
  ];
  if (badAgents > 0) parts.push(`${badAgents} agents degraded`);
  return `[${intel.generated_at}] ${parts.join(' · ')}`;
}
