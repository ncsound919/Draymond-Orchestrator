// ============================================================================
// DISCOVERY LOOP DAEMON — keep the Benchmark Olympics discovery loop cycling
// in the background for as long as Draymond is live.
// ============================================================================
// An in-process interval (like the Kairos daemon) that runs the discovery-loop
// script headless on a cadence (default every 30 min) and auto-fixes weak
// components via the repair team. Lives and dies with the Draymond process —
// no external cron required.
//
// Guardrails:
//   - Idempotent start (one timer per process), single-flight per tick.
//   - The spawned script carries its own file lock so daemon + scheduler +
//     manual runs never overlap.
//   - Best-effort: a missing sibling app or a script failure logs and continues.
//
// Config:
//   DRAYMOND_DISCOVERY_LOOP_ENABLED   = "0" disables the daemon (default on)
//   DRAYMOND_DISCOVERY_LOOP_INTERVAL_MS = cadence in ms (default 30 min)
//   DRAYMOND_DISCOVERY_LOOP_ITERATIONS  = loop iterations per run (default 1)
// Command Center controls (controls.json) override the env vars at call-time.
// ============================================================================

import { runDiscoveryLoopScript } from "./discovery-loop-runner";
import {
  syncDiscoveryIntervalMs,
  syncDiscoveryIterations,
  syncDiscoveryEnabled,
} from "@/lib/command-center/controls";

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

const daemonEnabled = (): boolean => syncDiscoveryEnabled(process.env.DRAYMOND_DISCOVERY_LOOP_ENABLED);
const intervalMs = (): number => syncDiscoveryIntervalMs(process.env.DRAYMOND_DISCOVERY_LOOP_INTERVAL_MS);
const iterations = (): number => syncDiscoveryIterations(process.env.DRAYMOND_DISCOVERY_LOOP_ITERATIONS);

async function tick(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const res = await runDiscoveryLoopScript({ iterations: iterations(), repair: true });
    const tail = (res.stdout || "").trim().split(/\r?\n/).slice(-8).join(" | ");
    if (res.ok) {
      console.log(`[discovery-loop] daemon run ok in ${res.durationMs}ms${tail ? ` :: ${tail}` : ""}`);
    } else {
      console.warn(`[discovery-loop] daemon run failed (${res.durationMs}ms): ${res.error ?? "unknown error"}`);
    }
  } catch (err) {
    console.error(`[discovery-loop] daemon tick threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    _running = false;
  }
}

/**
 * Start the discovery-loop daemon (idempotent). Called from the cognition layer
 * at server boot so research + auto-fix run continuously while Draymond is up.
 */
export function startDiscoveryLoopDaemon(): void {
  if (_timer) return; // already running
  if (!daemonEnabled()) {
    console.log("[discovery-loop] daemon disabled (DRAYMOND_DISCOVERY_LOOP_ENABLED=0)");
    return;
  }
  // Catch-up run immediately at boot, then on the cadence.
  void tick();
  _timer = setInterval(() => void tick(), intervalMs());
  _timer.unref?.(); // never keep the process alive by itself
  console.log(`[discovery-loop] daemon started (every ${Math.round(intervalMs() / 60_000)} min, ${iterations()} iteration(s)/run)`);
}

/** Stop the daemon (tests / teardown). */
export function stopDiscoveryLoopDaemon(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/** True while a daemon tick is running (tests). */
export function isDiscoveryLoopDaemonRunning(): boolean {
  return _running;
}
