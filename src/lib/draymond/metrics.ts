// ============================================================================
// DRAYMOND METRICS — Prometheus exposition (OSS failure-loop detection)
// ============================================================================
// Exposes orchestrator health as Prometheus text metrics so Prometheus +
// Alertmanager (or any OSS scraper) can detect failure loops: job fail_rate,
// agent consecutive errors, monitors down, repairs, events, lessons.
//
// `renderMetrics()` queries the local DB + JSON stores on each scrape and sets
// gauge values, then returns the registry text. Every query is fail-soft: with
// a fresh/missing DB the endpoint still serves process + node metrics.
// ============================================================================

import { Registry, Gauge, collectDefaultMetrics } from 'prom-client';
import { createDraymondAdminClient } from './client';

let _registry: Registry | null = null;
let _gauges: ReturnType<typeof buildGauges> | null = null;

function buildGauges(register: Registry) {
  return {
    agents: new Gauge({ name: 'draymond_agents_total', help: 'Agents by status', labelNames: ['status'] as const, registers: [register] }),
    agentErrors: new Gauge({ name: 'draymond_agent_consecutive_errors', help: 'Consecutive errors per agent', labelNames: ['agent'] as const, registers: [register] }),
    jobs: new Gauge({ name: 'draymond_jobs_total', help: 'Scheduled jobs by last run status', labelNames: ['status'] as const, registers: [register] }),
    jobFailRate: new Gauge({ name: 'draymond_job_fail_rate', help: 'Failure ratio (fail_count/run_count) per job', labelNames: ['job'] as const, registers: [register] }),
    monitors: new Gauge({ name: 'draymond_monitors_total', help: 'Site monitors by status', labelNames: ['status'] as const, registers: [register] }),
    repairs: new Gauge({ name: 'draymond_repair_attempts_total', help: 'Repair attempts by status', labelNames: ['status'] as const, registers: [register] }),
    events24h: new Gauge({ name: 'draymond_events_total_24h', help: 'Audit events in the last 24 hours', registers: [register] }),
    lessons: new Gauge({ name: 'draymond_lessons_total', help: 'Distilled self-learning lessons', registers: [register] }),
  };
}

function registry(): Registry {
  if (!_registry) {
    _registry = new Registry();
    collectDefaultMetrics({ register: _registry });
    _gauges = buildGauges(_registry);
  }
  return _registry;
}

/** Aggregate rows into label counts. */
function countByStatus(rows: Array<{ status: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** Query + publish the orchestrator state for the current scrape. Fail-soft. */
async function refresh(): Promise<void> {
  const g = _gauges;
  if (!g) return;
  const db = createDraymondAdminClient();

  // Agents — status distribution + consecutive errors (failure-loop signal).
  try {
    const { data } = await db.from('draymond_agents').select('id, status, consecutive_errors');
    const rows = (data ?? []) as Array<{ id: string; status: string; consecutive_errors: number }>;
    g.agents.reset();
    for (const [k, v] of Object.entries(countByStatus(rows))) g.agents.labels(k).set(v);
    g.agentErrors.reset();
    for (const r of rows) {
      if (r.consecutive_errors > 0) g.agentErrors.labels(r.id).set(r.consecutive_errors);
    }
  } catch {
    /* DB not ready yet — skip */
  }

  // Jobs — status distribution + per-job fail rate (the "failure loop" signal).
  try {
    const { data } = await db.from('draymond_scheduled_jobs').select('name, last_run_status, run_count, fail_count');
    const rows = (data ?? []) as Array<{ name: string; last_run_status: string | null; run_count: number; fail_count: number }>;
    g.jobs.reset();
    for (const [k, v] of Object.entries(countByStatus(rows.map((r) => ({ status: r.last_run_status ?? 'never' }))))) {
      g.jobs.labels(k).set(v);
    }
    g.jobFailRate.reset();
    for (const r of rows) {
      const runs = Number(r.run_count ?? 0);
      if (runs > 0) g.jobFailRate.labels(r.name).set((Number(r.fail_count ?? 0) / runs));
    }
  } catch {
    /* skip */
  }

  // Site monitors — status distribution.
  try {
    const { data } = await db.from('draymond_site_monitors').select('current_status');
    const rows = (data ?? []) as Array<{ current_status: string }>;
    g.monitors.reset();
    for (const [k, v] of Object.entries(countByStatus(rows.map((r) => ({ status: r.current_status ?? 'unknown' }))))) {
      g.monitors.labels(k).set(v);
    }
  } catch {
    /* skip */
  }

  // Repairs + lessons come from the JSON stores (fail-soft readers).
  try {
    const { repairLog } = await import('./self-repair');
    const log = await repairLog(200);
    g.repairs.reset();
    for (const [k, v] of Object.entries(countByStatus(log.map((r) => ({ status: r.status }))))) {
      g.repairs.labels(k).set(v);
    }
  } catch {
    /* skip */
  }
  try {
    const { getLessons } = await import('./self-learning');
    const lessons = await getLessons();
    g.lessons.set(lessons.length);
  } catch {
    /* skip */
  }
  try {
    const { data, count } = await db.from('draymond_events').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    g.events24h.set(count ?? (data ?? []).length);
  } catch {
    /* skip */
  }
}

/** Render the full Prometheus exposition text (call from the /metrics route). */
export async function renderMetrics(): Promise<string> {
  const reg = registry();
  await refresh();
  return reg.metrics();
}
