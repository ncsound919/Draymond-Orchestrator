// ============================================================================
// DRAYMOND BOOTSTRAP — bring the ecosystem to life at process startup
// ============================================================================
// Called from instrumentation.ts at server boot. Ensures the control plane is
// actually USEFUL on first launch instead of a passive dashboard:
//
//   1. seedBasicJobs()        — create the default cron set (idempotent)
//   2. startCoreServices()    — boot the deterministic brain + core agents that
//                               Draymond's jobs depend on, so the first
//                               scheduler tick doesn't spam "fetch failed".
//   3. warmHeartbeats()       — record live liveness for every roster service.
//
// All steps are best-effort and fail-soft: a broken service never blocks the
// orchestrator from coming up.
//
// Env knobs:
//   DRAYMOND_AUTOSTART=0                — disable the whole bootstrap
//   DRAYMOND_AUTOSTART_SERVICES=0       — seed jobs only, don't start services
//   DRAYMOND_CORE_SERVICES=a,b,c        — override the default core service set
// ============================================================================

import { seedBasicJobs } from './scheduler';
import { startDownServices, probeService } from './service-manager';
import { seedAgentMonitors, disableAbsentServiceMonitors } from './monitors';
import { installFallbackRegistry } from './fallback-registry';
import { getFallbackCoverage } from './fallbacks';

/** Services that the daily jobs depend on; started automatically at boot.
 * Only slugs with a working start recipe in service-manager.ts AND a real
 * runnable entrypoint are included — anything else would probe + escalate on
 * every boot. */
export const DEFAULT_CORE_SERVICES = [
  'deterministic-brain',
  'bookbridge',
  'omni-research',
  'uplift-agent',
  'opencode',
  'sports-steve',
  'social-media-dashboard',
  'hemp-os',
  'hempforge',
] as const;

/**
 * Declarative boot graph — the fleet analogue of the kernel's `dirs` file,
 * which lists boot stages in dependency order (preldr32 → romdec32 → bldr32).
 * Each service lists the services that must be up BEFORE it. Start order is a
 * stable topological sort of this graph, so ordering is data, not sequence:
 * the repair team can re-order or add edges at runtime without a code change.
 *
 * All edges are empty by default (declaration order = current behavior). Add
 * an edge only when there is evidence one service needs another up first —
 * otherwise you silently reorder the fleet. Extend at runtime via
 * `DRAYMOND_BOOT_GRAPH` (JSON: `{ slug: { dependsOn: string[] } }`) — merges
 * over these defaults.
 */
export const BOOT_GRAPH: Record<string, { dependsOn: string[] }> = {
  'deterministic-brain': { dependsOn: [] }, // the reasoning engine — always first
  bookbridge: { dependsOn: [] },
  'omni-research': { dependsOn: [] },
  'uplift-agent': { dependsOn: [] },
  opencode: { dependsOn: [] },
  'sports-steve': { dependsOn: [] },
  'social-media-dashboard': { dependsOn: [] },
  'hemp-os': { dependsOn: [] },
  hempforge: { dependsOn: [] },
};

/** Load the boot graph, merging operator-defined edges from env. */
export function loadBootGraph(): Record<string, { dependsOn: string[] }> {
  const merged: Record<string, { dependsOn: string[] }> = {};
  for (const [slug, node] of Object.entries(BOOT_GRAPH)) {
    merged[slug] = { dependsOn: [...node.dependsOn] };
  }
  const raw = process.env.DRAYMOND_BOOT_GRAPH;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, { dependsOn?: unknown }>;
      for (const [slug, node] of Object.entries(parsed)) {
        if (node && Array.isArray(node.dependsOn)) {
          merged[slug] = { dependsOn: node.dependsOn.filter((d): d is string => typeof d === 'string') };
        }
      }
    } catch (err) {
      console.warn('[bootstrap] DRAYMOND_BOOT_GRAPH invalid JSON, ignoring:', err instanceof Error ? err.message : String(err));
    }
  }
  return merged;
}

/**
 * Stable topological sort of the boot graph. Services whose dependencies are
 * all satisfied come first; independent services keep their declaration order
 * (deterministic). Unknown deps and cycles are logged and skipped rather than
 * dead-locking the boot.
 */
export function orderBootServices(
  slugs: string[],
  graph: Record<string, { dependsOn: string[] }> = loadBootGraph(),
): string[] {
  const set = new Set(slugs);
  const ordered: string[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const unknown = new Set<string>();

  const visit = (slug: string, stack: string[]): void => {
    if (placed.has(slug)) return;
    if (visiting.has(slug) || stack.includes(slug)) {
      console.warn(`[bootstrap] boot graph cycle detected at "${slug}" — ordering by declaration order`);
      return;
    }
    visiting.add(slug);
    for (const dep of graph[slug]?.dependsOn ?? []) {
      if (!set.has(dep)) {
        unknown.add(dep);
        continue;
      }
      visit(dep, [...stack, slug]);
    }
    visiting.delete(slug);
    placed.add(slug);
    if (ordered.includes(slug)) return;
    ordered.push(slug);
  };

  for (const slug of slugs) visit(slug, []);
  if (unknown.size > 0) {
    console.warn(`[bootstrap] boot graph references unknown services: ${[...unknown].join(', ')} (ignored)`);
  }
  // Include any slugs the cycle-guard skipped so nothing is silently dropped.
  for (const slug of slugs) if (!ordered.includes(slug)) ordered.push(slug);
  return ordered;
}

/**
 * Full startup bootstrap — seed jobs then bring up the core fleet.
 * Best-effort: never throws, always resolves.
 */
export async function bootstrapEcosystem(): Promise<{
  seededJobs: number;
  servicesAttempted: number;
  servicesUp: number;
  servicesStarted: number;
  skipped: boolean;
}> {
  const autostart = process.env.DRAYMOND_AUTOSTART !== '0';
  if (!autostart) {
    return { seededJobs: 0, servicesAttempted: 0, servicesUp: 0, servicesStarted: 0, skipped: true };
  }

  // Install the deterministic-fallback registry so every LLM function has a
  // declared "what to do when ALL LLMs are down" answer, then surface coverage.
  installFallbackRegistry();
  const fbCoverage = getFallbackCoverage();
  console.log(
    `[bootstrap] fallback registry: ${fbCoverage.covered}/${fbCoverage.total} LLM functions deterministic-capable (${fbCoverage.pct}%)`
  );
  if (fbCoverage.uncovered.length > 0) {
    console.warn(`[bootstrap] fallback registry uncovered: ${fbCoverage.uncovered.join(', ')}`);
  }

  // 1. Seed the default cron set so the scheduler has work on first boot.
  let seededJobs = 0;
  try {
    seededJobs = await seedBasicJobs();
    if (seededJobs > 0) {
      console.log(`[bootstrap] created ${seededJobs} default scheduled job(s)`);
    }
  } catch (err) {
    console.warn('[bootstrap] seedBasicJobs skipped:', err instanceof Error ? err.message : err);
  }

  // 1b. Seed site monitors and disable the ones for services not present on
  // this machine, so the fleet doesn't fire "down" forever for agents that
  // aren't supposed to run here (OmniResearch, Indy Music, Overlay Chain, ...).
  try {
    const monitorResult = await seedAgentMonitors();
    const changed = await disableAbsentServiceMonitors();
    if (monitorResult.created > 0 || changed > 0) {
      console.log(`[bootstrap] monitors: ${monitorResult.created} created, ${changed} reconciled (absent services)`);
    }
  } catch (err) {
    console.warn('[bootstrap] monitor seed skipped:', err instanceof Error ? err.message : err);
  }

  // 2. Bring up the core services (deterministic brain first — it's the
  //    reasoning engine every brain_decision_cycle depends on).
  const startServices = process.env.DRAYMOND_AUTOSTART_SERVICES !== '0';
  if (!startServices) {
    return { seededJobs, servicesAttempted: 0, servicesUp: 0, servicesStarted: 0, skipped: false };
  }

  const raw = process.env.DRAYMOND_CORE_SERVICES;
  const core =
    raw && raw.trim().length > 0
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : [...DEFAULT_CORE_SERVICES];

  // Boot order is the topological sort of the boot graph (dependency edges),
  // not the raw array — ordering is data, so DRAYMOND_BOOT_GRAPH can re-order
  // the fleet without a code change.
  const bootOrder = orderBootServices(core);

  let servicesAttempted = 0;
  let servicesUp = 0;
  let servicesStarted = 0;

  for (const slug of bootOrder) {
    // Skip services that are explicitly unconfigured (no start recipe / no
    // working dir). startDownServices already no-ops for unconfigured slugs,
    // but probing first keeps the boot log clean.
    try {
      const before = await probeService(slug, 1200);
      servicesAttempted += 1;
      if (before.up) {
        servicesUp += 1;
        continue;
      }
      const after = await startDownServices([slug]);
      servicesUp += after.filter((s) => s.up).length;
      servicesStarted += after.filter((s) => s.up).length;
      if (after.length > 0 && after[0].up) {
        console.log(`[bootstrap] started ${slug} -> ${after[0].url}`);
      } else {
        console.warn(`[bootstrap] ${slug} down after start attempt: ${after[0]?.detail ?? 'no detail'}`);
      }
    } catch (err) {
      console.warn('[bootstrap] %s start skipped:', slug, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `[bootstrap] core fleet: ${servicesUp}/${servicesAttempted} up (${servicesStarted} started this boot)`
  );
  return { seededJobs, servicesAttempted, servicesUp, servicesStarted, skipped: false };
}
