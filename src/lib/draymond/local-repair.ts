// ============================================================================
// DRAYMOND LOCAL REPAIR — free, on-device first pass for the repair crew
// ============================================================================
// The host runs llama.cpp (`llama-server`) on :11434 serving MiniCPM5-2B via an
// OpenAI-compatible API. It is tiny and cheap, so it is the right tool for:
//   - failure triage / classification refinement
//   - minimal job_config proposals (short, structured, verifiable)
// It is NOT trusted for real code synthesis — those failures route to Axiom's
// verified project loop. Every call is bounded and fail-soft: null / the
// deterministic baseline on any failure, never a fabricated result.
//
// Kill switch: DRAYMOND_REPAIR_LOCAL_FIRST=0 (or OLLAMA_ENABLED=0).
// ============================================================================

import type { FailureKind } from './repair-team';
import { callLLM } from './llm';

const LOCAL_TIMEOUT_MS = Number(process.env.DRAYMOND_REPAIR_LOCAL_TIMEOUT_MS) || 25_000;

export const FAILURE_KINDS: readonly FailureKind[] = [
  'chain_config',
  'notification_config',
  'missing_env',
  'service_down',
  'code_error',
  'benchmark_weak',
  'unknown',
];

/** Is the local-first engine enabled? */
export function repairLocalEnabled(): boolean {
  if (process.env.DRAYMOND_REPAIR_LOCAL_FIRST === '0') return false;
  // Under vitest, stay off unless a test explicitly opts in — unit tests must
  // not make real network calls to the local model.
  if (process.env.VITEST && process.env.DRAYMOND_REPAIR_LOCAL_FIRST !== '1') return false;
  const ollama = (process.env.OLLAMA_ENABLED ?? '').toLowerCase();
  if (ollama === '0' || ollama === 'false' || ollama === 'no') return false;
  return true;
}

/** Extract the first balanced JSON object from a model reply. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** One bounded local call. Returns the raw text, or null on failure/timeout. */
async function callLocalText(system: string, user: string, maxTokens: number): Promise<string | null> {
  try {
    const raw = await callLLM({
      provider: 'ollama',
      system,
      userMessage: user,
      maxTokens,
      temperature: 0,
      timeoutMs: LOCAL_TIMEOUT_MS,
      responseFormat: { type: 'json_object' },
    });
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export interface LocalTriageResult {
  kind: FailureKind;
  confidence: number;
  rationale: string;
  source: 'local-model' | 'deterministic';
}

/**
 * Refine the deterministic failure classification with the local model.
 * Falls back to `deterministicKind` verbatim when local is disabled/offline.
 */
export async function localFailureTriage(input: {
  jobName: string;
  jobType: string;
  error: string;
  deterministicKind: FailureKind;
}): Promise<LocalTriageResult> {
  const baseline: LocalTriageResult = {
    kind: input.deterministicKind,
    confidence: 0,
    rationale: 'deterministic baseline',
    source: 'deterministic',
  };
  if (!repairLocalEnabled()) return baseline;

  const system =
    'You triage failed automation jobs. Reply with ONLY a JSON object. Never invent credentials or fabricate output.';
  const user = [
    `Classify the failure into exactly one kind: ${FAILURE_KINDS.join(', ')}.`,
    `Job: ${input.jobName} (${input.jobType})`,
    `Error: ${input.error.slice(0, 800)}`,
    'If unsure use "unknown".',
    'Return {"kind":"<kind>","confidence":<0..1>,"rationale":"<short>"}',
  ].join('\n');

  const raw = await callLocalText(system, user, 200);
  const obj = raw ? extractJsonObject(raw) : null;
  if (!obj) return baseline;

  const kind =
    typeof obj.kind === 'string' && (FAILURE_KINDS as readonly string[]).includes(obj.kind)
      ? (obj.kind as FailureKind)
      : input.deterministicKind;
  const confidence =
    typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
      ? Math.max(0, Math.min(1, obj.confidence))
      : 0;
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 300) : '';
  return { kind, confidence, rationale, source: 'local-model' };
}

/**
 * Ask the local model for a minimal corrected job_config. Returns the raw reply
 * (for tryApplyJobConfigPatch), or null when local is disabled/offline or the
 * model declines. Never applies anything itself — the caller validates.
 */
export async function localJobConfigProposal(input: {
  jobName: string;
  jobType: string;
  error: string;
  jobConfig: Record<string, unknown>;
  lessons?: string[];
  recourseBlock?: string;
}): Promise<{ content: string; model: string } | null> {
  if (!repairLocalEnabled()) return null;

  const system =
    'You are the Draymond local repair agent. Output ONLY the corrected job_config JSON. ' +
    'Never invent credentials or fabricate service output.';
  const user = [
    'A scheduled job is failing. Propose a minimal corrected job_config.',
    `JOB: ${input.jobName} (type: ${input.jobType})`,
    `CURRENT CONFIG: ${JSON.stringify(input.jobConfig).slice(0, 800)}`,
    `ERROR: ${input.error.slice(0, 800)}`,
    input.lessons?.length ? `LESSONS:\n${input.lessons.join('\n').slice(0, 600)}` : '',
    input.recourseBlock ? `VERIFIED PRIOR ART:\n${input.recourseBlock.slice(0, 1500)}` : '',
    'If config changes are needed, output ONLY the corrected job_config JSON object.',
    'Otherwise reply exactly: NO_CONFIG_FIX',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await callLocalText(system, user, 512);
  if (!raw) return null;
  if (/NO_CONFIG_FIX/i.test(raw) && !raw.includes('{')) return null;
  return { content: raw, model: process.env.OLLAMA_MODEL || 'local' };
}
