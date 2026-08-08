// ============================================================================
// DRAYMOND AGENT IDE — Codegang client
// ============================================================================
// Codegang (agents/Codegang) is the local deep-analysis engine: 6 scanners +
// 6 innovation engines that produce 0-100 scores and findings without needing
// a GitHub repo. Draymond uses its content-based single-file analysis as the
// "local reviewer" in the review gate. All calls fail soft — an offline
// Codegang must never break a session.
// ============================================================================

export interface CodegangFinding {
  id?: string;
  category?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info' | string;
  title?: string;
  description?: string;
  file?: string;
  line?: number;
  snippet?: string;
  fixSuggestion?: string;
  cwe?: string;
  owasp?: string;
}

export interface CodegangScore {
  /** 0-100, higher is better. */
  qualityScore: number;
  totalIssues: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export interface CodegangAnalyzeResult {
  success: boolean;
  filePath?: string;
  language?: string;
  metrics?: CodegangScore;
  findings?: CodegangFinding[];
  error?: string;
}

export interface CodegangHealth {
  name?: string;
  version?: string;
  status?: string;
}

function config(): { url: string; key: string } {
  const url = process.env.CODEGANG_URL ?? 'http://localhost:3204';
  return { url: url.replace(/\/+$/, ''), key: process.env.CODEGANG_API_KEY ?? '' };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config().key) h['Authorization'] = `Bearer ${config().key}`;
  return h;
}

async function post<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${config().url}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Codegang ${path} failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Score a single file via Codegang's content-based analyzer. Pass `content`
 * so no filesystem access or sandbox path is required on Codegang's side.
 * Never throws.
 */
export async function codegangAnalyzeFile(input: {
  filePath: string;
  content: string;
  language?: string;
}): Promise<CodegangAnalyzeResult> {
  try {
    const res = await post<{ success: boolean; result?: CodegangAnalyzeResult; error?: string }>(
      '/api/analyze-comprehensive',
      {
        filePath: input.filePath,
        content: input.content,
        language: input.language,
      },
      90_000,
    );
    if (!res.success) return { success: false, error: res.error ?? 'Codegang analysis failed' };
    return {
      success: true,
      filePath: input.filePath,
      language: res.result?.language ?? input.language,
      metrics: res.result?.metrics,
      findings: res.result?.findings,
    };
  } catch (err) {
    return {
      success: false,
      filePath: input.filePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CodegangHealingAction {
  regressionId?: string;
  filePath?: string;
  type?: 'auto_fix' | 'suggested_fix' | 'rollback' | 'test_addition' | 'guard_clause' | string;
  description?: string;
  originalContent?: string;
  proposedContent?: string;
  validationStatus?: 'pending' | 'passed' | 'failed' | 'skipped' | string;
  confidence?: number;
}

export interface CodegangHealResult {
  success: boolean;
  actions: CodegangHealingAction[];
  regressions?: number;
  error?: string;
  duration_ms: number;
}

/**
 * Run Codegang's self-healing pipeline against a directory. Returns the
 * HealingActions (original→proposed code patches) the team can apply. Never throws.
 */
export async function codegangHealProject(
  repoPath: string,
  opts: { useLLM?: boolean; timeoutMs?: number } = {},
): Promise<CodegangHealResult> {
  const started = Date.now();
  try {
    const res = await post<{ success: boolean; result?: { regressions?: unknown[]; actions?: CodegangHealingAction[] }; error?: string }>(
      '/api/innovations/heal',
      { repoPath, useLLM: opts.useLLM ?? false },
      opts.timeoutMs ?? 120_000,
    );
    if (!res.success) {
      return { success: false, actions: [], error: res.error ?? 'heal failed', duration_ms: Date.now() - started };
    }
    return {
      success: true,
      actions: res.result?.actions ?? [],
      regressions: res.result?.regressions?.length,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return { success: false, actions: [], error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - started };
  }
}

/** True when the Codegang server is reachable. Never throws. */
export async function codegangIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${config().url}/api`, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface CodegangFinishInput {
  projectPath: string;
  autoMode?: boolean;
  skipTests?: boolean;
  skipLint?: boolean;
  maxIterations?: number;
}

export interface CodegangFinishResult {
  success: boolean;
  completionScore?: number;
  filesCreated?: string[];
  filesModified?: string[];
  iterations?: number;
  summary?: string;
  error?: string;
  duration_ms: number;
}

/**
 * Run Codegang's deterministic Project Finisher against a workspace (SSE
 * endpoint). Reads the stream until the `result` event. Never throws.
 */
export async function codegangFinishProject(input: CodegangFinishInput): Promise<CodegangFinishResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${config().url}/api/finish`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        projectPath: input.projectPath,
        options: {
          autoMode: input.autoMode ?? true,
          skipTests: input.skipTests ?? true,
          skipLint: input.skipLint ?? true,
          maxIterations: input.maxIterations ?? 3,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status} ${detail.slice(0, 200)}`, duration_ms: Date.now() - started };
    }
    if (!res.body) {
      return { success: false, error: 'no response body', duration_ms: Date.now() - started };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let errorText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finish: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { type?: string; data?: unknown };
            if (parsed.type === 'result') {
              finish = parsed.data ?? {};
              break;
            }
            if (parsed.type === 'error') {
              const msg = (parsed.data as { message?: string } | undefined)?.message ?? 'finisher error';
              errorText = msg;
            }
          } catch {
            // ignore non-JSON SSE lines
          }
        }
        if (finish) break;
      }
      if (finish) break;
    }

    if (errorText) {
      return { success: false, error: errorText, duration_ms: Date.now() - started };
    }
    if (!finish) {
      return { success: false, error: 'finisher produced no result event', duration_ms: Date.now() - started };
    }
    return {
      success: finish.success !== false,
      completionScore: typeof finish.completionScore === 'number' ? finish.completionScore : undefined,
      filesCreated: Array.isArray(finish.filesCreated) ? finish.filesCreated.map(String) : undefined,
      filesModified: Array.isArray(finish.filesModified) ? finish.filesModified.map(String) : undefined,
      iterations: typeof finish.iterations === 'number' ? finish.iterations : undefined,
      summary: typeof finish.summary === 'string' ? finish.summary : undefined,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - started };
  }
}
