// ============================================================================
// DRAYMOND — Daily Free Model Assignment Runner
// ============================================================================
// Orchestrates the 04:00 UTC daily cron cycle:
//   1. Runs runFreeCatalogSync() to probe openrouter + opencode catalogs.
//   2. Updates .draymond/model-routing.json with the winning assignedFreeModel.
//   3. Deterministically patches ecosystem.patch.yml model ID (backup created).
//   4. Logs audit event to repair-log.json.
// ============================================================================

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runFreeCatalogSync } from './freeCatalogSync';

export interface DailyAssignmentResult {
  assignedModel: string;
  latencyMs: number;
  probed: number;
  eligible: number;
  patchedFiles: string[];
  executedAt: string;
}

/** Deterministically patch model ID in Deepseek Harness/ecosystem.patch.yml */
function patchEcosystemYaml(assignedModel: string): boolean {
  try {
    const root = process.env.UPLIFT_ROOT ?? 'C:\\Users\\User\\Downloads\\Uplift';
    const patchPath = join(root, 'Deepseek Harness', 'ecosystem.patch.yml');
    if (!existsSync(patchPath)) return false;

    const bakPath = `${patchPath}.bak`;
    copyFileSync(patchPath, bakPath);

    let content = readFileSync(patchPath, 'utf8');
    // Capture the CURRENT model id from the agent-default-model `model:` line
    // so the `- id:` entry for the model is patched too — never hardcode the
    // old id (free models rotate). Only `model:` fields and the model's own
    // `- id:` entry change; structural ids (fs-sandbox, system-prompt, ...)
    // must stay untouched.
    const currentModel = /(?:^|\n)\s*model:\s*([\w\-\.]+)/.exec(content)?.[1];
    let updated = content.replace(/model:\s*[\w\-\._]+/g, `model: ${assignedModel}`);
    if (currentModel && currentModel !== assignedModel) {
      updated = updated.replace(
        new RegExp(`(^\\s*- id:\\s*)${currentModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gm'),
        `$1${assignedModel}`
      );
    }

    if (updated !== content) {
      writeFileSync(patchPath, updated, 'utf8');
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Log outcome to .draymond/repair-log.json (append-only). */
function logToRepairLog(result: DailyAssignmentResult): void {
  try {
    const registryDir = process.env.DRAYMOND_REGISTRY_DIR ?? join(process.cwd(), '.draymond');
    const logPath = join(registryDir, 'repair-log.json');
    let logs: unknown[] = [];
    if (existsSync(logPath)) {
      try {
        logs = JSON.parse(readFileSync(logPath, 'utf8')) as unknown[];
      } catch {
        logs = [];
      }
    }
    logs.push({
      event: 'free_model_daily_assignment',
      timestamp: result.executedAt,
      assignedModel: result.assignedModel,
      latencyMs: result.latencyMs,
      probed: result.probed,
      eligible: result.eligible,
      patchedFiles: result.patchedFiles,
    });
    writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf8');
  } catch {
    /* fail-soft */
  }
}

export async function runDailyAssignment(): Promise<DailyAssignmentResult> {
  const executedAt = new Date().toISOString();
  console.info(`[dailyAssignment] starting 04:00 UTC cycle at ${executedAt}`);

  const syncRes = await runFreeCatalogSync({ dryRun: false });
  const patchedFiles: string[] = [];

  if (patchEcosystemYaml(syncRes.assignedModel)) {
    patchedFiles.push('Deepseek Harness/ecosystem.patch.yml');
  }

  const result: DailyAssignmentResult = {
    assignedModel: syncRes.assignedModel,
    latencyMs: syncRes.latencyMs,
    probed: syncRes.probed,
    eligible: syncRes.eligible,
    patchedFiles,
    executedAt,
  };

  logToRepairLog(result);
  console.info(`[dailyAssignment] completed cycle: assigned=${result.assignedModel} patched=${patchedFiles.length} files`);
  return result;
}
