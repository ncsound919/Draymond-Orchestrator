/**
 * tid-daemon.ts — In-process autonomous daemon for the Trends, Insights & Discoveries (TID) Engine.
 *
 * Runs continuously in the background while Draymond is alive:
 * - Collects fleet signals across benchmarks, science bridges, executions, and learning loops.
 * - Detects velocity shifts, statistical anomalies, and cross-domain opportunities.
 * - Promotes high-confidence discoveries and dispatches self-healing repairs.
 * - Measures post-repair outcomes to complete the closed-loop self-improvement feedback cycle.
 */

import { TidEngine } from './tid-engine';

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

function isEnabled(): boolean {
  return process.env.DRAYMOND_TID_ENABLED !== '0';
}

function intervalMs(): number {
  const raw = Number(process.env.TID_DAEMON_INTERVAL_MS ?? 15 * 60 * 1000);
  return Number.isFinite(raw) && raw >= 10_000 ? raw : 15 * 60 * 1000;
}

/**
 * Execute a single TID analysis cycle (guarded by single-flight flag).
 */
export async function runTidTick(): Promise<void> {
  if (_running) return;
  _running = true;

  try {
    const report = await TidEngine.runAnalysisCycle();
    if (report.insightsGenerated > 0 || report.discoveriesPromoted > 0 || report.outcomesMeasured > 0) {
      console.log(
        `[tid-daemon] cycle completed in ${report.durationMs}ms :: ` +
        `processed=${report.signalsProcessed}, insights=+${report.insightsGenerated}, ` +
        `discoveries=+${report.discoveriesPromoted}, dispatched=+${report.actionsDispatched}, ` +
        `measured=+${report.outcomesMeasured}`
      );
    }
  } catch (err) {
    console.warn('[tid-daemon] tick failed:', err instanceof Error ? err.message : String(err));
  } finally {
    _running = false;
  }
}

/**
 * Start the TID background daemon (idempotent).
 */
export function startTidDaemon(): void {
  if (_timer) return; // Already running

  if (!isEnabled()) {
    console.log('[tid-daemon] daemon disabled (DRAYMOND_TID_ENABLED=0)');
    return;
  }

  // Initial catch-up run at boot
  void runTidTick();

  _timer = setInterval(() => void runTidTick(), intervalMs());
  _timer.unref?.(); // Don't hold node process alive solely for timer

  console.log(`[tid-daemon] daemon started (cadence: ${Math.round(intervalMs() / 60_000)} min)`);
}

/**
 * Stop the daemon (for tests / shutdown).
 */
export function stopTidDaemon(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/**
 * Check if a daemon tick is currently running.
 */
export function isTidDaemonRunning(): boolean {
  return _running;
}
