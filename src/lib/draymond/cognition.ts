/**
 * Cognition layer — shared base for Kairos · AutoDream · Ultraplan.
 *
 * JSON-state helpers (fail-soft), the idle gate, and the deep-LLM lane
 * (native reasoning when available, draft→critique→revise deepen loop
 * otherwise). Dependency direction: `ultraplan → cognition → llm` — this
 * module must NOT top-level-import scheduler/chains (lazy imports only),
 * or it cycles with the scheduler's lazy handler imports.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { callLLM, hasKey } from './llm';

// ============================================================================
// DEEP PLAN ARTIFACT — the shared plan shape (owned here, consumed by ultraplan)
// ============================================================================

export interface PlanChange {
  file: string;
  description: string;
  line?: string;
}

export interface UltraplanArtifact {
  goals: string[];
  phases: string[];
  steps: string[];
  changes: PlanChange[];
  dependencies: string[];
  risks: string[];
  verification: string[];
  tokenEstimate: number;
}

// ============================================================================
// JSON STATE
// ============================================================================

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
}

export function stateFile(name: string): string {
  return path.join(registryDir(), `${name}.json`);
}

/** Read `.draymond/<name>.json`; fail-soft to the fallback. */
export async function readJsonState<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(stateFile(name), 'utf-8');
    const parsed = JSON.parse(raw) as T;
    if (parsed && typeof parsed === 'object') return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

/** Write `.draymond/<name>.json` with an updatedAt stamp (registry pattern). */
export async function writeJsonState(name: string, data: unknown): Promise<void> {
  await fs.mkdir(registryDir(), { recursive: true });
  await fs.writeFile(
    stateFile(name),
    JSON.stringify({ ...(data as object), updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// IDLE GATE
// ============================================================================

/**
 * True when Draymond is idle enough for a background pass:
 * outside the 05:00–09:30 morning burst AND no scheduler job is running AND
 * no chain is executing. Cheap DB reads only (limit 1).
 */
export async function isSystemIdle(): Promise<boolean> {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins >= 300 && mins <= 570) return false; // 05:00–09:30 morning burst

  const { listJobs } = await import('./scheduler');
  const { listChains } = await import('./chains');
  const [runningJobs, runningChains] = await Promise.all([
    listJobs({ last_run_status: 'running', limit: 1 }).catch(() => []),
    listChains({ status: 'running', limit: 1 }).catch(() => []),
  ]);
  return runningJobs.length === 0 && runningChains.length === 0;
}

// ============================================================================
// DEEP LLM LANE
// ============================================================================

/** True when a reasoning-capable provider key is configured. */
export function hasNativeReasoning(): boolean {
  return hasKey('deepseek') || hasKey('anthropic') || hasKey('openai');
}

function preferredReasoningProvider(): 'deepseek' | 'anthropic' | 'openai' | undefined {
  for (const p of ['deepseek', 'anthropic', 'openai'] as const) {
    if (hasKey(p)) return p;
  }
  return undefined;
}

/** Deep reasoning call (long timeout, generous budget, JSON out). */
export async function callDeepLLM(opts: {
  system: string;
  userMessage: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  return callLLM({
    provider: preferredReasoningProvider(),
    system: opts.system,
    userMessage: opts.userMessage,
    reasoning: true,
    maxTokens: opts.maxTokens ?? 4096,
    timeoutMs: opts.timeoutMs ?? 120_000,
    responseFormat: { type: 'json_object' },
    fallbackKey: 'cognition.callDeepLLM',
  });
}

/** Parse a (possibly code-fenced) JSON plan artifact. Throws on garbage. */
export function parseArtifact(text: string): UltraplanArtifact {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const raw = JSON.parse(cleaned) as Record<string, unknown>;
  const arr = (k: string): string[] =>
    Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const changes: PlanChange[] = (Array.isArray(raw.changes) ? raw.changes : []).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return {
      file: String(o.file ?? ''),
      description: String(o.description ?? ''),
      line: typeof o.line === 'string' ? o.line : undefined,
    };
  });
  return {
    goals: arr('goals'),
    phases: arr('phases'),
    steps: arr('steps'),
    changes,
    dependencies: arr('dependencies'),
    risks: arr('risks'),
    verification: arr('verification'),
    tokenEstimate: typeof raw.tokenEstimate === 'number' ? raw.tokenEstimate : 0,
  };
}

/**
 * Fallback deep lane when no reasoning-capable provider is configured:
 * `rounds` (default 3) of draft → critique → revise on the normal chain.
 * Returns the last parseable artifact; throws if none parses.
 */
export async function deepenLoop(
  opts: { system: string; userMessage: string },
  rounds = 3
): Promise<UltraplanArtifact> {
  let last = '';
  let lastParsed: UltraplanArtifact | null = null;
  for (let i = 0; i < rounds; i++) {
    const prompt =
      i === 0
        ? opts.userMessage
        : i === 1
          ? `Critique the following plan draft and list concrete weaknesses and gaps:\n\n${last}`
          : `Revise the plan into the final version, addressing the critique. Output ONLY the plan JSON:\n\n${last}`;
    last = await callLLM({
      system: opts.system,
      userMessage: prompt,
      maxTokens: 2048,
      localFirst: true,
      responseFormat: { type: 'json_object' },
      fallbackKey: 'cognition.deepenLoop',
    });
    try {
      lastParsed = parseArtifact(last);
    } catch {
      // keep refining
    }
  }
  if (lastParsed) return lastParsed;
  throw new Error('deepen loop produced no parseable plan');
}
