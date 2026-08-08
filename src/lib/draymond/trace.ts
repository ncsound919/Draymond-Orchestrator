// ============================================================================
// DRAYMOND LLM OBSERVABILITY — Langfuse ingestion (HTTP API, no SDK)
// ============================================================================
// When Langfuse is configured (LANGFUSE_URL + LANGFUSE_SECRET_KEY), every chat
// turn and router decision is sent as a trace so the "chat knows the system"
// behavior is auditable. When unconfigured this is a strict no-op — zero cost,
// zero failure risk. Uses the public ingestion HTTP API (no npm dependency).
// ============================================================================

// Env is read lazily at call time so tests can toggle configuration per case.
const lfEnv = () => ({
  base: process.env.LANGFUSE_URL ?? '',
  publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
  secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
});

export interface TraceObservation {
  id: string;
  type: 'GENERATION' | 'SPAN' | 'EVENT';
  name: string;
  startTime: string;
  endTime?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
}

export interface LangfuseTrace {
  id: string;
  name: string;
  timestamp: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  observations?: TraceObservation[];
}

/** True when the Langfuse endpoint + secret are configured. */
export function isLangfuseConfigured(): boolean {
  const env = lfEnv();
  return Boolean(env.base && env.secretKey);
}

/**
 * Ingest a trace to Langfuse. Never throws and never blocks — observability
 * must not take down the chat. Falls back silently when unconfigured.
 */
export async function ingestTrace(trace: LangfuseTrace): Promise<void> {
  if (!isLangfuseConfigured()) return;

  const env = lfEnv();
  try {
    const url = `${env.base.replace(/\/+$/, '')}/api/public/trace`;
    const auth = `Basic ${Buffer.from(`${env.publicKey}:${env.secretKey}`).toString('base64')}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(trace),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(`[langfuse] ingest failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fire-and-forget wrapper for request-scope callers. */
export function ingestTraceAsync(trace: LangfuseTrace): void {
  ingestTrace(trace).catch(() => {});
}
