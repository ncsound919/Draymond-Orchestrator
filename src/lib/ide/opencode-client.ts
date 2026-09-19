// ============================================================================
// DRAYMOND AGENT IDE — codegen engine (Axiom)
// ============================================================================
// Axiom replaces the retired local `opencode serve` headless codegen server.
// Axiom exposes an OpenAI-compatible endpoint for bot clients:
//   POST {AXIOM_URL}/v1/chat/completions   (Bearer / X-Axiom-Token)
// which forwards to its own harness chain. There is no session lifecycle to
// manage (create/send/delete) and no local process to spawn — the endpoint is
// synchronous text in, text out, matching the previous return contract.
//
// AUTH + URL live in ../draymond/axiom-client (shared with the Recourse bridge).
// `route` selects Axiom's lane: "auto" (default) or "local" (llama.cpp tier).
// ============================================================================

import { AXIOM_URL, axiomAuthHeaders } from '../draymond/axiom-client';

const AXIOM_MODEL = process.env.AXIOM_CODEGEN_MODEL ?? '';

export interface OpencodeResult {
  success: boolean;
  content: string;
  error?: string;
  duration_ms: number;
  model?: string;
}

/** Extract fenced code blocks from an assistant reply. Falls back to the raw text. */
export function extractCodeBlocks(content: string, language = 'ts'): string[] {
  // Escape regex metacharacters in the caller-supplied language tag so it can
  // never widen the pattern or trigger catastrophic backtracking.
  const safeLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- safeLanguage is regex-escaped above.
  const re = new RegExp('```(?:' + safeLanguage + '|typescript|ts|javascript|js)?\\s*\\n?([\\s\\S]*?)```', 'gi');
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]?.trim()) blocks.push(m[1].trim());
  }
  return blocks.length > 0 ? blocks : (content.trim() ? [content.trim()] : []);
}

/**
 * Run codegen for a prompt via Axiom. Never throws.
 * Kept as `runOpencodeCodegen` for callers; the engine is now Axiom.
 */
export async function runOpencodeCodegen(input: {
  prompt: string;
  workspace: string;
  model?: string;
  timeoutMs?: number;
  /** Axiom lane: "auto" (default) or "local" for the zero-cost llama.cpp tier. */
  route?: string;
}): Promise<OpencodeResult> {
  const started = Date.now();
  const timeout = input.timeoutMs ?? 180_000;
  const model = input.model ?? AXIOM_MODEL;

  try {
    const res = await fetch(`${AXIOM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...axiomAuthHeaders(),
      },
      body: JSON.stringify({
        ...(model ? { model } : {}),
        ...(input.route ? { route: input.route } : {}),
        messages: [
          {
            role: 'system',
            content:
              'You are the Draymond coding agent. Produce concise, correct output for the task. ' +
              'Never invent credentials or fabricate service output.',
          },
          { role: 'user', content: input.prompt },
        ],
        max_tokens: 4096,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        success: false,
        content: '',
        error: `axiom HTTP ${res.status} ${detail.slice(0, 200)}`,
        duration_ms: Date.now() - started,
      };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      modelUsed?: string;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      return { success: false, content: '', error: 'axiom returned no text', duration_ms: Date.now() - started };
    }
    return {
      success: true,
      content,
      duration_ms: Date.now() - started,
      model: data.modelUsed ?? model ?? 'axiom',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, content: '', error: message.slice(0, 500), duration_ms: Date.now() - started };
  }
}

/** Preferred name; same implementation. */
export const runCodegen = runOpencodeCodegen;
