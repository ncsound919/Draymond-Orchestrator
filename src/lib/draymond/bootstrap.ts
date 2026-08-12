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

  let servicesAttempted = 0;
  let servicesUp = 0;
  let servicesStarted = 0;

  for (const slug of core) {
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
      console.warn(`[bootstrap] ${slug} start skipped:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `[bootstrap] core fleet: ${servicesUp}/${servicesAttempted} up (${servicesStarted} started this boot)`
  );
  return { seededJobs, servicesAttempted, servicesUp, servicesStarted, skipped: false };
}
