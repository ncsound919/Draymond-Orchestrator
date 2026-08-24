// ============================================================================
// CHAT POLISH — turn raw structured results into conversational replies
// ============================================================================
// The orchestrate route returns whatever the routed entity/chain/status query
// produced: often a JSON blob or a terse "[Draymond] ..." string. Open-Chat
// renders that text directly, so the user sees machine output. This module
// humanizes those responses into warm, plain-language chat before they are
// streamed to the phone.
//
// Two tiers, kept deterministic and cheap:
//   1. When the response is valid JSON (the common case for query_status /
//      entity outputs / chain contexts), summarize it with one compact LLM
//      call. If the LLM is down, fall back to a readable text rendering.
//   2. When the response is already text, strip mechanical prefixes
//      ("[Draymond]", "[Route]") and rephrase into a friendlier sentence.
//
// The LLM call is best-effort: a failure to polish must never break the reply.
// ============================================================================

import { callLLM } from './llm';

/** Strings that are pure machine chatter and should not be surfaced. */
const MECHANICAL_PREFIXES = [
  '[Draymond] Routing task...',
  '[Draymond] Building chain from description...',
  '[Route] ',
  '\[Draymond\]',
];

/** True when the text is a JSON object or array (ignoring whitespace). */
function looksLikeJson(text: string): boolean {
  const t = String(text ?? '').trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** Render a JSON value as readable key → value lines for the fallback. */
function jsonToLines(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object') lines.push(...jsonToLines(item, depth + 1));
      else lines.push(`${pad}- ${String(item)}`);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) {
        lines.push(`${pad}${k}: ${v.length} item(s)`);
        lines.push(...jsonToLines(v, depth + 1));
      } else if (v && typeof v === 'object') {
        lines.push(`${pad}${k}:`);
        lines.push(...jsonToLines(v, depth + 1));
      } else {
        lines.push(`${pad}${k}: ${String(v)}`);
      }
    }
  } else {
    lines.push(`${pad}${String(value)}`);
  }
  return lines.join('\n');
}

/** Drop mechanical prefixes and normalize whitespace. */
function cleanText(raw: string): string {
  let text = String(raw ?? '').trim();
  for (const prefix of MECHANICAL_PREFIXES) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
    }
  }
  text = text
    .replace(/^\[Draymond\]\s*/g, '')
    .replace(/^\[Route\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/** One compact LLM call to turn a JSON result into a conversational reply. */
async function llmSummarize(jsonText: string): Promise<string | null> {
  try {
    const reply = await callLLM({
      localFirst: true,
      system:
        'You are the friendly voice of an AI business dashboard in a phone chat app. ' +
        'The user asked a question and the system produced the JSON below. Rewrite it as ' +
        'a warm, concise, conversational reply in plain English. Use natural sentences, ' +
        'no bullet-point dumps, no JSON, no field names, no markdown. If it is a status ' +
        'report, lead with the headline (e.g. "Everything looks healthy" or "3 agents need attention"). ' +
        'Keep it under 5 sentences.',
      userMessage: `User asked something and the system returned:\n${jsonText.slice(0, 3000)}`,
      maxTokens: 300,
      temperature: 0.4,
      timeoutMs: 20_000,
      fallbackKey: 'chat-polish.llmSummarize',
    });
    const trimmed = String(reply ?? '').trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Humanize a raw orchestration result for chat display.
 * Returns text safe to show the user. Never throws.
 */
export async function humanizeResponse(
  raw: string,
  _opts: { userTask?: string } = {},
): Promise<string> {
  const text = cleanText(raw);
  if (!text) return 'Done.';

  // JSON result → summarize via LLM, fall back to readable lines.
  if (looksLikeJson(raw)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (parsed !== null) {
      // Known shape: a wrapped entity invocation that nested real output.
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'output' in parsed &&
        Object.keys(parsed).length === 1
      ) {
        parsed = (parsed as Record<string, unknown>).output;
      }

      // Quick win for the dashboard summary — deterministic, no LLM needed.
      const summary = parsed as Record<string, unknown> | null;
      if (summary && typeof summary === 'object' && 'total_agents' in summary) {
        const parts: string[] = [];
        const total = Number(summary.total_agents ?? 0);
        const healthy = Number(summary.healthy_agents ?? 0);
        const stalled = Number(summary.stalled_agents ?? 0);
        const pending = Number(summary.pending_actions ?? 0);
        if (total === 0) {
          parts.push('No agents are registered yet.');
        } else if (stalled > 0) {
          parts.push(`⚠️ ${stalled} of ${total} agents need attention right now.`);
        } else if (healthy === total) {
          parts.push(`✅ All ${total} agents are healthy and online.`);
        } else {
          parts.push(`${healthy} of ${total} agents are healthy.`);
        }
        if (pending > 0) parts.push(`${pending} action${pending === 1 ? '' : 's'} waiting for your review.`);
        if (Number(summary.events_last_24h ?? 0) > 0) parts.push(`${summary.events_last_24h} events in the last 24h.`);
        return parts.join('\n');
      }

      // Otherwise try the LLM; fall back to readable key/value lines.
      const polished = await llmSummarize(raw);
      if (polished) return polished;
      return `Here's what I found:\n\n${jsonToLines(parsed)}`;
    }
  }

  // Plain text: strip chatter, humanize obvious status lines.
  if (/^(entity|chain) .* (not found|failed|error)/i.test(text)) {
    return text;
  }
  return text;
}
