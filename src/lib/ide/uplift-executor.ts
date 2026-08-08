// ============================================================================
// DRAYMOND AGENT IDE — Uplift executor
// ============================================================================
// Routes coding steps to the Uplift agent (Hermes fork, 52+ tools / 193+
// skills) over its HTTP API. This is the codegen workhorse: a step's prompt is
// dispatched as a task and the returned text becomes the step detail. Best
// effort file/test parsing is applied to surface visible progress.
// ============================================================================

import { dispatchTask, pingUplift } from '@/lib/uplift';

export interface UpliftStepResult {
  success: boolean;
  content: string;
  files: { path: string; action: 'created' | 'edited' | 'deleted' | 'untouched' }[];
  error?: string;
}

const FILE_PATH_RE = /(?:\/\/|#)\s*(?:created|added|edited|modified|changed|fixed|updated|removed|deleted|touched)\s*:\s*([\w./\\-]+\.\w+)|([\w./\\-]+\.[a-zA-Z]{1,6})/g;

/** Best-effort file change extraction from free-text step output. */
function extractFiles(content: string): UpliftStepResult['files'] {
  const seen = new Set<string>();
  const files: UpliftStepResult['files'] = [];
  if (!content) return files;
  for (const m of content.matchAll(FILE_PATH_RE)) {
    const p = (m[1] ?? m[2])?.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    files.push({ path: p, action: 'edited' });
  }
  return files.slice(0, 12);
}

/**
 * Dispatch a coding step to the Uplift agent. Times out after UPLIFT_TIMEOUT_MS.
 * Never throws — returns a structured result so the session runner stays alive.
 */
export async function runUpliftStep(input: {
  description: string;
  sessionId: string;
  context?: Record<string, unknown>;
  /** Optional external abort (session abort) combined with the hard timeout. */
  signal?: AbortSignal;
}): Promise<UpliftStepResult> {
  const sessionId = input.sessionId || `ide-${Date.now()}`;
  try {
    const timeoutSignal = AbortSignal.timeout(180_000);
    // AbortSignal.any is available on Node 20+. Combine the hard timeout with
    // the session abort; fall back to the external signal alone when any() is
    // unavailable so an abort still wins.
    const signal =
      typeof AbortSignal.any === 'function'
        ? AbortSignal.any([timeoutSignal, ...(input.signal ? [input.signal] : [])])
        : (input.signal ?? timeoutSignal);

    const result = (await dispatchTask(
      {
        task_id: `ide-${sessionId}-${Date.now()}`,
        description: input.description,
        agent: 'uplift',
        context: input.context ?? {},
        session_id: sessionId,
      },
      signal,
    )) as Record<string, unknown>;

    const content =
      (typeof result?.content === 'string' ? result.content : null) ??
      (typeof result?.output === 'string' ? result.output : null) ??
      (typeof result?.result === 'string' ? result.result : null) ??
      (typeof result?.message === 'string' ? result.message : null) ??
      JSON.stringify(result);

    return { success: true, content, files: extractFiles(content) };
  } catch (err) {
    return {
      success: false,
      content: '',
      files: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True when the Uplift agent is reachable. Never throws. */
export async function upliftIsUp(): Promise<boolean> {
  try {
    return await pingUplift();
  } catch {
    return false;
  }
}
