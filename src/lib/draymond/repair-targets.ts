// ============================================================================
// REPAIR TARGETS — map a failing job to the workspace Axiom should repair
// ============================================================================
// Axiom's project loop edits real files and runs real tests, so it needs a real
// targetDir. This resolves one — safely. It NEVER returns a path outside
// UPLIFT_ROOT, and returns null when nothing matches (the caller then falls back
// to proposal-only repair instead of guessing at a directory).
//
// Resolution order:
//   1. Explicit job_config path keys (targetDir, repo_path, ...).
//   2. Entity/service slug → TOOL_PORTS.cwd (relative to the Draymond repo root).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { TOOL_PORTS } from './ports';

const ORCH_DIR = process.cwd();
export const UPLIFT_ROOT = process.env.UPLIFT_ROOT || path.resolve(ORCH_DIR, '..');

export interface RepairTarget {
  targetDir: string;
  /** How the dir was resolved (for the repair report). */
  source: string;
}

export function repoRepairEnabled(): boolean {
  return process.env.DRAYMOND_REPAIR_PROJECT_LOOP !== '0';
}

/** True only for a path that exists, is a directory, and sits under UPLIFT_ROOT. */
function safeDir(candidate: string): string | null {
  try {
    const abs = path.resolve(candidate);
    const root = path.resolve(UPLIFT_ROOT);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return null;
    return abs;
  } catch {
    return null;
  }
}

const PATH_KEYS = ['targetDir', 'target_dir', 'repoPath', 'repo_path', 'repo', 'workspace', 'path', 'dir'] as const;

/** Normalize for fuzzy slug matching (lowercase, strip separators). */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function resolveRepairTargetDir(job: {
  name: string;
  job_type?: string;
  job_config?: Record<string, unknown>;
}): RepairTarget | null {
  const cfg = job.job_config ?? {};

  // 1. Explicit path keys.
  for (const key of PATH_KEYS) {
    const v = cfg[key];
    if (typeof v === 'string' && v.trim()) {
      const direct = safeDir(v);
      if (direct) return { targetDir: direct, source: `job_config.${key}` };
      const rooted = safeDir(path.resolve(UPLIFT_ROOT, v));
      if (rooted) return { targetDir: rooted, source: `job_config.${key} (uplift-rooted)` };
    }
  }

  // 2. Entity/service slug → canonical service cwd.
  const entity = [cfg.entity, cfg.service, cfg.agent, job.name]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map(norm);
  for (const tool of TOOL_PORTS) {
    if (!tool.cwd) continue;
    const slug = norm(tool.slug);
    const name = norm(tool.name);
    if (!entity.some((e) => e === slug || e === name || e.includes(slug) || slug.includes(e))) continue;
    const dir = safeDir(/*turbopackIgnore: true*/ path.resolve(ORCH_DIR, tool.cwd));
    if (dir) return { targetDir: dir, source: `service:${tool.slug}` };
  }

  return null;
}
