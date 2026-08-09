// ============================================================================
// DRAYMOND TOONIFY — token-efficient structured context for LLM prompts
// ============================================================================
// Detects structured JSON embedded in prompt text (```json fences and
// <context> blocks) and re-encodes it as TOON (Token-Oriented Object
// Notation) when that measurably shrinks the payload. TOON collapses repeated
// field names into a single header row, so uniform arrays of records (registry
// snapshots, contexts, RAG blocks) decode to far fewer tokens than JSON.
//
// Safety contract:
//   - A block is only swapped when it round-trips losslessly (decode(encode(x))
//     equals x) AND the TOON text is shorter than the compact JSON it replaces.
//   - Anything that fails to parse, fails to round-trip, or isn't smaller is
//     left byte-for-byte untouched, so prompts can never be corrupted.
// ============================================================================

import { decode, encode } from '@toon-format/toon';

/** Character overhead of the ```toon fence that replaces ```json. */
const FENCE_OVERHEAD = 16;

const JSON_FENCE_RE = /```json\s*\n([\s\S]*?)\n```/g;
const CONTEXT_RE = /<context>([\s\S]*?)<\/context>/g;

/** Parse JSON text; returns undefined when it isn't valid JSON. */
function safeParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Encode a value to TOON, or null when it isn't a strict improvement over the
 * compact JSON representation. Guarantees a lossless round-trip and a real size
 * win (accounting for the code-fence overhead) before returning a swap.
 */
export function toonifyValue(value: unknown): string | null {
  let toon: string;
  let decoded: unknown;
  try {
    toon = encode(value);
    decoded = decode(toon);
  } catch {
    return null;
  }
  // Lossless round-trip guard: never emit TOON that doesn't decode back to the
  // exact same JSON data model (key order included).
  if (JSON.stringify(decoded) !== JSON.stringify(value)) return null;

  const compact = JSON.stringify(value);
  // Only swap when strictly smaller — JSON still wins for deeply nested or
  // tiny payloads, and we must not trade tokens for garbage.
  if (toon.length + FENCE_OVERHEAD >= compact.length) return null;

  return toon;
}

/**
 * Scan prompt text and swap structured JSON blocks for TOON when beneficial.
 *
 * Handles:
 *   - ```json fenced blocks   → ```toon fenced blocks
 *   - <context>…</context>    → TOON inside the same tags
 *
 * Every other token of text passes through unchanged. Safe to run on any
 * prompt string; non-JSON content is never touched.
 */
export function toonifyJsonBlocks(text: string): string {
  if (!text) return text;

  let out = text;

  out = out.replace(JSON_FENCE_RE, (match, body: string) => {
    const value = safeParse(body);
    if (value === undefined) return match;
    const toon = toonifyValue(value);
    return toon === null ? match : `\`\`\`toon\n${toon}\n\`\`\``;
  });

  out = out.replace(CONTEXT_RE, (match, body: string) => {
    const value = safeParse(body);
    if (value === undefined) return match;
    const toon = toonifyValue(value);
    return toon === null ? match : `<context>\n\`\`\`toon\n${toon}\n\`\`\`\n</context>`;
  });

  return out;
}

/**
 * Apply TOON compression to an LLM call's messages. No-op unless the caller
 * opts in with `toonify: true`.
 */
export function prepareLLMMessages(options: {
  system?: string;
  userMessage?: string;
  toonify?: boolean;
}): { system: string; userMessage: string } {
  const system = options.system ?? '';
  const userMessage = options.userMessage ?? '';
  if (!options.toonify) return { system, userMessage };
  return {
    system: toonifyJsonBlocks(system),
    userMessage: toonifyJsonBlocks(userMessage),
  };
}
