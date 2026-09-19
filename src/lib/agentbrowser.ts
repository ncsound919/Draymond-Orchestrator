/**
 * Draymond client for AgentBrowser's browser skills.
 *
 * AgentBrowser controls real Playwright browser instances. Draymond uses it to
 * fetch files / page content when a task needs a document from the web.
 */

const AGENTBROWSER_URL = process.env.AGENTBROWSER_URL ?? "http://localhost:3700";
const AGENTBROWSER_API_KEY = process.env.AGENTBROWSER_API_KEY ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AGENTBROWSER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AGENTBROWSER_API_KEY ? { "X-Agent-Auth": AGENTBROWSER_API_KEY } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`AgentBrowser ${path} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export interface BrowserTaskResult {
  success?: boolean;
  content?: string;
  text?: string;
  error?: string;
  url?: string;
}

/**
 * Fetch page content / a file via AgentBrowser's browser pipeline.
 * `action` maps to the browser-task actions (e.g. "get-content", "extract").
 */
export async function browserFetch(
  url: string,
  action: "get-content" | "extract" | "download" = "get-content",
  selectors?: string[],
): Promise<BrowserTaskResult> {
  return post<BrowserTaskResult>("/api/browser-task", { action, url, selectors });
}

/** Fetch a file by URL (best-effort via the browser). */
export async function fetchFileByUrl(url: string): Promise<BrowserTaskResult> {
  return browserFetch(url, "extract");
}

export interface SiteTestReport {
  runAt: string;
  suite: string;
  overall: "pass" | "fail" | "partial";
  sites: Array<{
    siteId: string;
    siteLabel: string;
    url: string;
    status: string;
    loadMs: number;
    consoleErrors: string[];
    failedRequests: string[];
    brokenLinks: string[];
  }>;
  summary: { passed: number; failed: number; errored: number };
}

// -- Web search via AgentBrowser's Playwright browser ------------------------

export interface WebSearchHit {
  title: string;
  url: string;
}

export interface WebSearchPage {
  url: string;
  text: string;
}

export interface WebSearchResult {
  query: string;
  results: WebSearchHit[];
  pages: WebSearchPage[];
}

/** DuckDuckGo's JS-free HTML results page — stable anchor markup for scraping. */
const SEARCH_ENGINE_URL = 'https://html.duckduckgo.com/html/';

/** In-page expression: extract the top result links + titles. */
const SEARCH_LINK_SCRIPT =
  "Array.from(document.querySelectorAll('a.result__a')).slice(0, 20).map(a => ({ title: (a.textContent || '').trim(), url: a.href }))";

/**
 * Web search powered by AgentBrowser's Playwright browser.
 *
 * Launches a headless browser, navigates to the DuckDuckGo HTML results page,
 * extracts the result links with an in-page `evaluate`, then fetches the top
 * result pages as readable text via the browser-task `reader`.
 */
export async function webSearch(
  query: string,
  opts: { limit?: number; fetchPages?: boolean } = {},
): Promise<WebSearchResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 10));
  const fetchPages = opts.fetchPages ?? true;

  const launched = await post<{ success?: boolean; error?: string }>('/api/browser-control', {
    action: 'launch',
    config: { headless: true },
  });
  if (!launched?.success) {
    throw new Error(launched?.error ?? 'AgentBrowser browser launch failed');
  }

  try {
    const nav = await post<{ success?: boolean; error?: string }>('/api/browser-control', {
      action: 'navigate',
      url: `${SEARCH_ENGINE_URL}?q=${encodeURIComponent(query)}`,
    });
    if (!nav?.success) throw new Error(nav?.error ?? 'Search navigation failed');

    const extracted = await post<{ success?: boolean; result?: unknown }>('/api/browser-control', {
      action: 'execute',
      script: SEARCH_LINK_SCRIPT,
    });

    const results: WebSearchHit[] = Array.isArray(extracted?.result)
      ? (extracted.result as WebSearchHit[]).filter((r) => r && r.url && r.title)
      : [];

    const pages: WebSearchPage[] = [];
    if (fetchPages && results.length > 0) {
      const targets = results.slice(0, limit);
      const settled = await Promise.allSettled(
        targets.map((h) =>
          post<BrowserTaskResult>('/api/browser-task', { action: 'reader', url: h.url }),
        ),
      );
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.success && r.value.content) {
          pages.push({ url: targets[i].url, text: r.value.content });
        }
      });
    }

    return { query, results: results.slice(0, limit), pages };
  } finally {
    await post('/api/browser-control', { action: 'close' }).catch(() => {});
  }
}

/**
 * Run the Overlay365 Playwright QA suite via AgentBrowser's testing tool.
 * suite: "all" | "overlay365" | "health" | "wealth" | "justice".
 */
export async function runSiteTests(suite = "all"): Promise<SiteTestReport> {
  const res = await fetch(`${AGENTBROWSER_URL}/api/testing?suite=${encodeURIComponent(suite)}`, {
    method: "GET",
    headers: AGENTBROWSER_API_KEY ? { "X-Agent-Auth": AGENTBROWSER_API_KEY } : {},
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`AgentBrowser /api/testing failed: HTTP ${res.status}`);
  return res.json() as Promise<SiteTestReport>;
}

export function agentBrowserUrl(): string {
  return AGENTBROWSER_URL;
}

export function isAgentBrowserConfigured(): boolean {
  return Boolean(AGENTBROWSER_API_KEY);
}
