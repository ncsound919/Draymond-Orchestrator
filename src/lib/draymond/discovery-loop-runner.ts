// ============================================================================
// DISCOVERY LOOP RUNNER — spawn the Benchmark Olympics discovery-loop script
// ============================================================================
// Shared by the background daemon and the scheduler's `benchmark_discovery_loop`
// handler. Resolves the sibling Benchmark Olympics app + a local tsx runtime and
// runs the headless discovery-loop script with a bounded timeout. Never throws.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

export interface DiscoveryLoopRunResult {
  ok: boolean;
  stdout: string;
  error?: string;
  durationMs: number;
}

/** Resolve the Benchmark Olympics discovery-loop script path (or null). */
export function resolveDiscoveryLoopScript(): string | null {
  const candidates: string[] = [];
  if (process.env.BENCHMARK_OLYMPICS_ROOT) {
    candidates.push(path.join(process.env.BENCHMARK_OLYMPICS_ROOT, "scripts", "discovery-loop-run.ts"));
  }
  // The standalone Next server runs with cwd = .next/standalone (server.js
  // chdirs there at boot), so cwd-relative lookups alone can't find the
  // sibling app. Anchor on the canonical registry dir when it is set (pm2
  // pins DRAYMOND_REGISTRY_DIR to <root>/.draymond) and derive the ecosystem
  // root from it.
  if (process.env.DRAYMOND_REGISTRY_DIR) {
    const orchRoot = path.resolve(process.env.DRAYMOND_REGISTRY_DIR, "..");
    candidates.push(
      path.resolve(orchRoot, "..", "Benchmark Olympics", "scripts", "discovery-loop-run.ts"),
      path.resolve(orchRoot, "Benchmark Olympics", "scripts", "discovery-loop-run.ts"),
    );
  }
  candidates.push(
    path.resolve(process.cwd(), "..", "Benchmark Olympics", "scripts", "discovery-loop-run.ts"),
    path.resolve(process.cwd(), "Benchmark Olympics", "scripts", "discovery-loop-run.ts"),
    path.resolve(process.cwd(), "scripts", "discovery-loop-run.ts"),
  );
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Resolve a local `tsx` CLI entry so we don't depend on npx/network. */
export function resolveTsxCli(scriptPath: string): string | null {
  const appRoot = path.resolve(path.dirname(scriptPath), "..");
  const candidates = [
    path.join(appRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(process.cwd(), "..", "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

const run = promisify(execFile);

/**
 * Run the Benchmark Olympics discovery-loop script headless. Options:
 *   iterations — loop iterations per run (default 1).
 *   repair     — dispatch weak components to the repair team (defaults to the
 *                DRAYMOND_REPAIR_BENCHMARK_ENABLED gate).
 *   timeoutMs  — hard cap for the spawned process (default 6 min).
 *   script     — explicit script path override (tests / diagnostics).
 */
export async function runDiscoveryLoopScript(
  opts: { iterations?: number; repair?: boolean; timeoutMs?: number; script?: string } = {},
): Promise<DiscoveryLoopRunResult> {
  const script = opts.script ?? resolveDiscoveryLoopScript();
  if (!script || !fs.existsSync(script)) {
    return { ok: false, stdout: "", error: "Benchmark Olympics discovery-loop-run.ts not found (sibling app missing?)", durationMs: 0 };
  }
  const appRoot = path.resolve(path.dirname(script), "..");
  const iterations = Math.max(1, Math.min(4, opts.iterations ?? 1));
  const repair = opts.repair ?? process.env.DRAYMOND_REPAIR_BENCHMARK_ENABLED !== "0";
  const args = ["--iterations", String(iterations), ...(repair ? ["--repair"] : [])];
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 6 * 60 * 1000;

  const tsxCli = resolveTsxCli(script);
  if (tsxCli && tsxCli.endsWith(".mjs")) {
    // node <tsx cli> <script> — cross-platform, no .cmd/cmd.exe quoting issues.
    try {
      const out = await run("node", [tsxCli, script, ...args], { cwd: appRoot, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return { ok: true, stdout: out.stdout ?? "", durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, stdout: "", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
    }
  }
  if (tsxCli) {
    // .cmd/.bin fallback — route through cmd.exe on Windows.
    try {
      const command = process.platform === "win32" ? "cmd.exe" : tsxCli;
      const cmdArgs = process.platform === "win32" ? ["/c", tsxCli, script, ...args] : [script, ...args];
      const out = await run(command, cmdArgs, { cwd: appRoot, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return { ok: true, stdout: out.stdout ?? "", durationMs: Date.now() - started };
    } catch (err) {
      return { ok: false, stdout: "", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
    }
  }

  // No local tsx — fall back to npx (cached).
  try {
    const command = process.platform === "win32" ? "cmd.exe" : "npx";
    const cmdArgs = process.platform === "win32" ? ["/c", "npx", "--yes", "tsx", script, ...args] : ["--yes", "tsx", script, ...args];
    const out = await run(command, cmdArgs, { cwd: appRoot, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, stdout: out.stdout ?? "", durationMs: Date.now() - started };
  } catch (err) {
    return { ok: false, stdout: "", error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started };
  }
}
