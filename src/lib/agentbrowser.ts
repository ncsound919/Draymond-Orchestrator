/**
 * Draymond client for AgentBrowser's browser skills.
 *
 * AgentBrowser controls real Playwright browser instances. Draymond uses it to
 * fetch files / page content when a task needs a document from the web.
 */

const AGENTBROWSER_URL = process.env.AGENTBROWSER_URL ?? "http://localhost:3000";
const AGENTBROWSER_API_KEY = process.env.AGENTBROWSER_API_KEY ?? "";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AGENTBROWSER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AGENTBROWSER_API_KEY ? { Authorization: `Bearer ${AGENTBROWSER_API_KEY}` } : {}),
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
