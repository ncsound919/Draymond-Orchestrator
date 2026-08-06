/**
 * Draymond client for the BookBridge book library.
 *
 * Gives agents access to the 133-book library for factual grounding: search,
 * retrieve, citations, reading plans, and a daily scan hook (via the scheduler).
 */

const BASE_URL = process.env.BOOKBRIDGE_URL ?? "http://127.0.0.1:8777";

/** Fast health probe so callers fail in <1s when BookBridge is offline. */
async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`BookBridge ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface BookResult {
  chunk_id: string;
  book_id: string;
  text: string;
  page_start?: number | null;
  page_end?: number | null;
  section_heading?: string | null;
  book_title?: string;
  authors?: string[] | null;
  year?: number | null;
  score?: number;
}

export interface SearchResponse {
  results: BookResult[];
  total_matches: number;
  query_ms: number;
}

/** Search the library. */
export async function searchBooks(query: string, maxResults = 5, minScore = 0.3): Promise<BookResult[]> {
  const res = await post<SearchResponse>("/search", {
    query,
    max_results: maxResults,
    min_score: minScore,
    search_mode: "hybrid",
    include_context_chunks: true,
    context_window_chunks: 1,
  });
  return res.results;
}

/**
 * Ground a task/prompt with relevant book passages. This is the "keep agents on
 * factual data" hook: for an applicable topic, it pulls the top matching passages
 * from the library so agents reason from verified sources, not memorized guesswork.
 */
export async function groundWithBooks(topic: string, maxResults = 4, minScore = 0.25): Promise<{
  grounded: boolean;
  topic: string;
  passages: { book: string; passage: string; score: number }[];
  warning?: string;
}> {
  if (!topic || topic.trim().length < 12) {
    return { grounded: false, topic, passages: [], warning: "topic too short to ground" };
  }
  try {
    // Fast-fail when the library is offline so grounding never blocks a task.
    if (!(await isReachable())) {
      return { grounded: false, topic, passages: [], warning: "bookbridge offline" };
    }
    const results = await searchBooks(topic, maxResults, minScore);
    if (!results.length) {
      return { grounded: false, topic, passages: [], warning: "no relevant passages found" };
    }
    return {
      grounded: true,
      topic,
      passages: results.map((r) => ({
        book: r.book_title ?? r.book_id,
        passage: r.text.slice(0, 1200),
        score: r.score ?? 0,
      })),
    };
  } catch (err) {
    return {
      grounded: false,
      topic,
      passages: [],
      warning: `bookbridge unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Trigger a library scan (used by the daily scheduler job). */
export async function scanBookLibrary(): Promise<{ added_count: number; skipped: number }> {
  return post<{ added_count: number; skipped: number }>("/scan", { force: false });
}

/** Build a citation for a book. */
export async function citation(bookId: string, style = "apa"): Promise<string> {
  const res = await post<{ citation?: string }>("/citation", { book_id: bookId, style });
  return res.citation ?? "";
}

/** Generate a reading plan for a topic. */
export async function readingPlan(topic: string, goal?: string): Promise<unknown> {
  return post("/reading_plan", { topic, goal, max_books: 5, max_passages_per_book: 3 });
}

export function libraryHealthUrl(): string {
  return `${BASE_URL}/health`;
}
