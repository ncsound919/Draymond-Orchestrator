/**
 * retrieval.ts — lightweight RAG for the local (small) model tier.
 *
 * A small on-device model can't recall the system's history or lessons. This
 * module pulls the most relevant stores (distilled lessons + important memory)
 * and formats them as a compact context block that callers inject into the
 * small model's prompt. This is the "retrieve what the model can't remember"
 * layer — no external vector DB required.
 */
import { getDb } from '@/lib/db/connection';
import { getLessons } from './self-learning';

export interface RetrievedContext {
  block: string;
  sources: { type: string; id: string; summary: string }[];
}

const MAX_LESSONS = 6;
const MAX_MEMORY = 8;

/**
 * Best-effort LLMLingua-2 compression of a context block via the local
 * compressor service. Returns the original block if the service is down or
 * the compression fails — never throws.
 */
export async function compressContextBlock(block: string): Promise<string> {
  if (!block || process.env.LLMLINGUA_DISABLE === '1') return block;
  const url = process.env.LLMLINGUA_URL ?? 'http://127.0.0.1:3212';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${url}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: block, rate: 0.5 }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return block;
    const data = (await res.json()) as { compressed_prompt?: string };
    const out = data.compressed_prompt?.trim();
    return out && out.length > 0 ? out : block;
  } catch {
    return block;
  }
}

/**
 * Build a compact RAG context block for a local-model call.
 * @param query - the task/question (used for a naive keyword filter)
 * @param compress - optionally run LLMLingua-2 over the block (best-effort)
 */
export async function retrieveContext(
  query?: string,
  compress = false,
): Promise<RetrievedContext> {
  const sources: RetrievedContext['sources'] = [];

  // 1. Distilled lessons (JSON file store) — most evidence wins.
  let lessons: Awaited<ReturnType<typeof getLessons>> = [];
  try {
    lessons = await getLessons();
  } catch {
    lessons = [];
  }
  const q = (query ?? '').toLowerCase();
  const relevantLessons = lessons
    .filter((l) => {
      if (!q) return true;
      const hay = `${l.pattern ?? ''} ${l.lesson ?? ''}`.toLowerCase();
      const words = q.split(/\s+/).filter((w) => w.length > 3);
      return words.length === 0 || words.some((w) => hay.includes(w));
    })
    .sort((a, b) => (b.evidenceCount ?? 0) - (a.evidenceCount ?? 0))
    .slice(0, MAX_LESSONS);

  const lessonLines = relevantLessons.map((l) => `- lesson: ${l.lesson?.slice(0, 160) ?? ''}`);
  for (const l of relevantLessons) {
    sources.push({ type: 'lesson', id: l.id, summary: l.lesson?.slice(0, 120) ?? '' });
  }

  // 2. Important memory rows (DB) — importance_score + recent.
  let memoryLines: string[] = [];
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, summary, key, importance_score, updated_at
         FROM draymond_memory
         WHERE is_active = 1 AND summary IS NOT NULL AND summary != ''
         ORDER BY importance_score DESC, updated_at DESC
         LIMIT ?`
      )
      .all(MAX_MEMORY) as Array<{ id: string; summary: string; key: string }>;
    memoryLines = rows.map((r) => `- memory: ${r.summary.slice(0, 160)}`);
    for (const r of rows) {
      sources.push({ type: 'memory', id: r.id, summary: r.summary.slice(0, 120) });
    }
  } catch {
    memoryLines = [];
  }

  const parts: string[] = [];
  if (lessonLines.length) parts.push(`<known_lessons>\n${lessonLines.join('\n')}\n</known_lessons>`);
  if (memoryLines.length) parts.push(`<system_memory>\n${memoryLines.join('\n')}\n</system_memory>`);

  let block = parts.join('\n\n');
  if (compress && block) {
    const compressed = await compressContextBlock(block);
    if (compressed !== block) block = compressed;
  }

  return {
    block,
    sources,
  };
}

/** Inject retrieved context into a local-model prompt if any was found. */
export function augmentWithContext(
  system: string,
  contextBlock: string,
): string {
  if (!contextBlock) return system;
  return `${system}\n\nUse the following system knowledge where relevant:\n${contextBlock}`;
}
