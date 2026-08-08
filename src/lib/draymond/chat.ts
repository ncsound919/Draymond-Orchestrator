// ============================================================================
// DRAYMOND — Conversational Orchestration
// ============================================================================
// Backend brain for the Draymond Chat interface. Takes a natural-language
// message (plus the surrounding conversation) and dispatches it to the right
// tool — an entity, a chain, the status/dashboard query, or the Uplift agent
// as the general fallback. This is the "quick answer" path: no crons, no
// workflows, no manual routing. The intelligent task router decides where the
// message should go, exactly like the /api/v1/orchestrate endpoint but tuned
// for a back-and-forth dashboard chat session.
//
// Pure server-side module — no Next.js request context, so it is unit-testable
// and reusable by any route handler.
// ============================================================================

import { randomUUID } from 'crypto';
import { appendAuditLog } from '@/lib/audit';
import { dispatchTask } from '@/lib/uplift';
import { webSearch } from '@/lib/agentbrowser';
import { getEntity } from './registry';
import { invokeEntity } from './invoker';
import { instantiateChain, executeChain } from './chains';
import { routeAndClassify } from './router';
import { logExecution } from './confidence';
import { callLLM } from './llm';
import { submitAction } from './index';
import { getSystemIntel, formatSystemIntel } from './system-intel';
import { ingestTraceAsync } from './trace';
import { createIdeSession, startIdeSession } from '@/lib/ide';
import {
  AETHERDESK_OPERATIONS,
  executeAetherDeskOperation,
  getOperationRisk,
  resolveAetherDeskAgentId,
} from './aetherdesk';
import type { RouteResult } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatTurnOptions {
  /** The latest user message — the thing to get done. */
  task: string;
  /** Full conversation history (prior turns). Used for context + routing. */
  conversation?: ChatMessage[];
  /** Optional structured context merged into routing. */
  metadata?: Record<string, unknown>;
  /** Streaming callback — called with text chunks as they are produced. */
  onChunk?: (chunk: string) => void | Promise<void>;
}

export type ChatTurnStatus = 'completed' | 'needs_confirmation' | 'error';

export interface ChatTurnResult {
  result: string;
  status: ChatTurnStatus;
  route?: RouteResult;
  entity_slug?: string;
  chain_slug?: string;
}

const UPLIFT_TIMEOUT_MS = 60_000;
const CONVERSATION_CONTEXT_LIMIT = 8;

// ── Coding-team dispatch ─────────────────────────────────────────────────────

/** Loose signal that a task is code work rather than an entity/chain/query. */
const CODING_REQUEST_RE =
  /(fix|repair|debug|refactor|rewrite|implement|build|create|write|add|generate|restructure|clean up|compile|typecheck|upgrade|migrate|regression)\b[\s\S]{0,80}\b(code|app|api|service|function|module|component|endpoint|script|config|repo|project|feature|bug|error|crash|timeout|issue|tests?|build)/i;

function isCodingRequest(task: string): boolean {
  return CODING_REQUEST_RE.test(task);
}

/**
 * Spin up an IDE coding session from the chat and stream its plan + live link.
 * The session runs in the background; the user can watch and interject at /ide.
 */
async function handleCodingTask(
  task: string,
  metadata: Record<string, unknown>,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  await emit(onChunk, '\nDispatching the coding team…\n\n');

  const session = await createIdeSession({
    goal: task.slice(0, 2000),
    createdBy: typeof metadata.user_id === 'string' ? metadata.user_id : 'chat',
    workspace: typeof metadata.workspace === 'string' ? metadata.workspace : undefined,
    repoUrl: typeof metadata.repo_url === 'string' ? metadata.repo_url : undefined,
    context: metadata,
  });

  void startIdeSession(session.id).catch(() => {});

  const lines = [
    `**Coding team assembled** — lead: ${session.crew.lead}`,
    `Members: ${session.crew.members.join(', ')}`,
    '',
    'Plan:',
    ...session.steps.map((s, i) => `${i + 1}. **${s.title}** (${s.agent}/${s.kind})`),
    '',
    `Watch them work live and interject: **/ide/${session.id}**`,
  ];
  const text = lines.join('\n');
  await streamText(text, onChunk);
  return text;
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

async function emit(onChunk: ChatTurnOptions['onChunk'], chunk: string): Promise<void> {
  if (onChunk) await onChunk(chunk);
}

/** Stream `text` in small chunks so the UI animates token-by-token. */
async function streamText(
  text: string,
  onChunk: ChatTurnOptions['onChunk'],
  chunkSize = 40,
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    await emit(onChunk, text.slice(i, i + chunkSize));
  }
}

// ---------------------------------------------------------------------------
// Dispatchers
// ---------------------------------------------------------------------------

async function invokeEntityBySlug(
  slug: string,
  metadata: Record<string, unknown>,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  const entity = await getEntity(slug);
  if (!entity) {
    const msg = `Entity "${slug}" is not registered.`;
    await streamText(msg, onChunk);
    return msg;
  }

  const action = (metadata.action as string) ?? 'default';
  const input = (metadata.input as Record<string, unknown>) ?? {};
  const startMs = Date.now();

  try {
    const result = await invokeEntity(
      {
        id: entity.id,
        slug: entity.slug,
        name: entity.name,
        kind: entity.kind,
        invocation_method: entity.invocation_method,
        invocation_config: (entity.invocation_config as Record<string, unknown>) ?? {},
        timeout_seconds: entity.timeout_seconds ?? 30,
      },
      action,
      input,
    );

    logExecution({
      entity_id: entity.id,
      entity_slug: entity.slug,
      action,
      success: result.success,
      duration_ms: Date.now() - startMs,
      input_summary: JSON.stringify(input).slice(0, 500),
      output_summary: result.success ? JSON.stringify(result.output).slice(0, 500) : '',
      error_message: result.success ? undefined : result.error,
    }).catch(() => {});

    const text = result.success
      ? JSON.stringify(result.output)
      : `Entity invocation failed: ${result.error}`;
    await streamText(text, onChunk);
    return text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logExecution({
      entity_id: entity.id,
      entity_slug: entity.slug,
      action,
      success: false,
      duration_ms: Date.now() - startMs,
      error_message: message,
    }).catch(() => {});
    const text = `Entity invocation error: ${message}`;
    await streamText(text, onChunk);
    return text;
  }
}

/**
 * AetherDesk special-case: low/medium-risk operations run immediately;
 * high/critical operations are queued for human approval (ntfy push).
 */
async function invokeAetherDesk(
  metadata: Record<string, unknown>,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  const action = typeof metadata.action === 'string' ? metadata.action : '';
  const input = (metadata.input as Record<string, unknown>) ?? {};
  const risk = getOperationRisk(action);

  if (!risk) {
    const supported = Object.keys(AETHERDESK_OPERATIONS).join(', ');
    const msg = `Unknown AetherDesk operation "${action}". Supported: ${supported}`;
    await streamText(msg, onChunk);
    return msg;
  }

  if (risk === 'low' || risk === 'medium') {
    const result = await executeAetherDeskOperation(action, input);
    const text = result.success
      ? JSON.stringify(result.output)
      : `AetherDesk operation failed: ${result.error}`;
    await streamText(text, onChunk);
    return text;
  }

  // high/critical → human approval via ntfy
  const agentId = await resolveAetherDeskAgentId();
  if (!agentId) {
    const msg = 'AetherDesk control agent is not registered — apply migration 009.';
    await streamText(msg, onChunk);
    return msg;
  }

  const tenantId = typeof input.tenant_id === 'string' ? input.tenant_id : 'TENANT-001';
  const { action: submitted } = await submitAction({
    agent_id: agentId,
    action_type: `aetherdesk:${action}`,
    description: `AetherDesk ${action}: ${JSON.stringify(input).slice(0, 200)}`,
    payload: {
      aetherdesk_operation: action,
      aetherdesk_input: input,
      tenant_id: tenantId,
    },
    confidence_score: 0.8,
    risk_level: risk,
  });

  const msg = 'High-risk AetherDesk order queued for approval — check your phone.';
  await streamText(msg, onChunk);
  return `${msg} (action ${submitted.id})`;
}

async function executeChainBySlug(
  slug: string,
  metadata: Record<string, unknown>,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  try {
    const chainInput = (metadata.input as Record<string, unknown>) ?? {};
    const agentId = metadata.agent_id as string | undefined;
    const instance = await instantiateChain(slug, chainInput, undefined, agentId);
    const ctx = await executeChain(instance.id, agentId);
    const text = JSON.stringify({
      chain_id: instance.id,
      context: ctx.context,
      steps: ctx.steps,
    });
    await streamText(text, onChunk);
    return text;
  } catch (err) {
    const text = `Chain execution error: ${err instanceof Error ? err.message : String(err)}`;
    await streamText(text, onChunk);
    return text;
  }
}

async function dispatchToUplift(task: string, metadata: Record<string, unknown>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLIFT_TIMEOUT_MS);
  const workflowId = `chat-${randomUUID()}`;

  try {
    const result = await dispatchTask(
      {
        task_id: workflowId,
        description: task,
        agent: 'uplift',
        context: metadata,
        session_id: `draymond-chat-${randomUUID()}`,
      },
      controller.signal,
    );

    clearTimeout(timer);

    const r = result as Record<string, unknown>;
    return (
      (typeof r?.content === 'string' ? r.content : null) ??
      (typeof r?.output === 'string' ? r.output : null) ??
      (typeof r?.result === 'string' ? r.result : null) ??
      (typeof r?.message === 'string' ? r.message : null) ??
      JSON.stringify(result)
    );
  } catch (upliftErr) {
    clearTimeout(timer);
    const isTimeout = upliftErr instanceof DOMException && upliftErr.name === 'AbortError';

    await appendAuditLog({
      event: 'chat_uplift_error',
      workflow_id: workflowId,
      error: upliftErr instanceof Error ? upliftErr.message : String(upliftErr),
      agent: 'draymond',
    });

    return isTimeout
      ? `Task received: "${task}"\n\nThe request timed out. The task has been logged and will be retried.`
      : `Task received: "${task}"\n\nThe Uplift agent is currently unavailable. The task has been logged and will be retried when the agent is back online.`;
  }
}

/** System prompt for deep system questions — the chat "knows the system". */
const SYSTEM_INTEL_SYSTEM_PROMPT =
  "You are Draymond, the orchestrator that runs this business's agent ecosystem. You know the system deeply: its agents, entities, chains/workflows, crons/scheduled jobs, site monitors, goals/agenda, repairs and the upgrade queue, memory, benchmarks, and the Graphify knowledge graph. Answer the user's question using ONLY the provided system snapshot. Be specific — name agents, jobs, workflows, and goals; cite counts and statuses. If the snapshot doesn't contain the answer, say so plainly and suggest a better question.";

/**
 * Deep system query — the chat knows the whole system. Compiles the system
 * intelligence snapshot (agents, agenda, crons, workflows, repairs, progress),
 * then answers the user's specific question with the LLM grounded in that
 * snapshot. Falls back to a deterministic formatted snapshot when the LLM is
 * unavailable.
 */
async function querySystemStatus(
  task: string,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  await emit(onChunk, '\nGathering system state…\n\n');

  let snapshot: string;
  try {
    snapshot = formatSystemIntel(await getSystemIntel());
  } catch (err) {
    const msg = `Could not read system state: ${err instanceof Error ? err.message : String(err)}`;
    await streamText(msg, onChunk);
    return msg;
  }

  try {
    const answer = await callLLM({
      system: SYSTEM_INTEL_SYSTEM_PROMPT,
      userMessage: `Question: ${task}\n\n<system_snapshot>\n${snapshot}\n</system_snapshot>`,
      maxTokens: 2000,
      temperature: 0.2,
    });
    await streamText(answer, onChunk);
    return answer;
  } catch {
    // Deterministic fallback — still answers from real system state.
    await streamText(snapshot, onChunk);
    return snapshot;
  }
}

/**
 * Perplexity-style web search: run a live search via AgentBrowser, pull the
 * top result pages, and synthesize a cited answer with the LLM.
 */
async function handleWebSearch(
  task: string,
  queryHint: string | undefined,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  const query = (queryHint ?? task).trim();

  try {
    await emit(onChunk, '\nSearching the web…\n\n');
    const search = await webSearch(query, { limit: 5, fetchPages: true });

    if (search.results.length === 0) {
      const text = `No web results found for "${query}".`;
      await streamText(text, onChunk);
      return text;
    }

    const sources = search.results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}`).join('\n');
    const pageText = search.pages
      .map((p, i) => `[Source ${i + 1}] ${p.url}\n${p.text.slice(0, 600)}`)
      .join('\n\n');

    const answer = await synthesizeSearchAnswer(query, sources, pageText);
    const text = `${answer}\n\n---\n**Sources**\n${sources}`;
    await streamText(text, onChunk);
    return text;
  } catch (err) {
    const text = `Web search unavailable: ${err instanceof Error ? err.message : String(err)}`;
    await streamText(text, onChunk);
    return text;
  }
}

/** Ask the LLM to answer a query from fetched web sources with inline citations. */
async function synthesizeSearchAnswer(
  query: string,
  sources: string,
  pageText: string,
): Promise<string> {
  try {
    return await callLLM({
      system:
        "You are Draymond's research assistant. Answer the user's query using ONLY the web sources provided. Cite sources inline as [1], [2], etc. If the sources don't contain an answer, say so clearly. Be concise and factual.",
      userMessage: `Query: ${query}\n\nSources:\n${sources}\n\nExtracted content:\n${pageText}`,
      maxTokens: 600,
      temperature: 0.3,
    });
  } catch {
    return `Top results for "${query}":\n${sources}`;
  }
}

// ---------------------------------------------------------------------------
// Main turn orchestrator
// ---------------------------------------------------------------------------

/**
 * Process a single chat turn: route the latest user message to the correct
 * tool, execute it, and return the final answer (streamed via `onChunk`).
 *
 * Routing mirrors /api/v1/orchestrate's auto-route behavior:
 *   - high-confidence entity/chain → auto-execute
 *   - status/health queries       → dashboard summary
 *   - uncertain routes            → needs_confirmation (returns route info)
 *   - everything else             → Uplift agent fallback
 */
export async function orchestrateChatTurn(
  options: ChatTurnOptions,
): Promise<ChatTurnResult> {
  const task = options.task.trim();
  const onChunk = options.onChunk;
  const metadata = options.metadata ?? {};
  const traceId = randomUUID();
  const traceStartMs = Date.now();

  if (!task) {
    const result = 'Please tell me what you need done.';
    await streamText(result, onChunk);
    return { result, status: 'error' };
  }

  // Give the router conversational context so follow-ups ("run it now",
  // "also check X") resolve against earlier turns.
  const conversation = (options.conversation ?? []).slice(-CONVERSATION_CONTEXT_LIMIT);
  const routerContext: Record<string, unknown> = {
    ...metadata,
    conversation: conversation.length > 0 ? conversation : undefined,
  };

  await appendAuditLog({
    event: 'chat_start',
    task_preview: task.slice(0, 200),
    agent: 'draymond',
  });

  const routeResult = await routeAndClassify(task, routerContext);
  const route = routeResult.route;

  const routeTarget =
    route.entity_slug ??
    route.chain_slug ??
    (route.intent === 'web_search' ? 'web' : 'uplift');
  await emit(onChunk, `\n[${route.intent} → ${routeTarget}] (${(route.confidence * 100).toFixed(0)}%)\n\n`);

  let resultText: string;
  let status: ChatTurnStatus = 'completed';
  let entity_slug: string | undefined;
  let chain_slug: string | undefined;

  if (routeResult.should_auto_execute && route.intent === 'invoke_entity' && route.entity_slug) {
    const merged = { ...metadata, action: route.action, input: route.input };
    entity_slug = route.entity_slug;
    resultText = route.entity_slug === 'aetherdesk'
      ? await invokeAetherDesk(merged, onChunk)
      : await invokeEntityBySlug(route.entity_slug, merged, onChunk);
  } else if (routeResult.should_auto_execute && route.intent === 'execute_chain' && route.chain_slug) {
    chain_slug = route.chain_slug;
    resultText = await executeChainBySlug(route.chain_slug, { ...metadata, input: route.input }, onChunk);
  } else if (route.intent === 'query_status') {
    resultText = await querySystemStatus(task, onChunk);
  } else if (route.intent === 'web_search') {
    resultText = await handleWebSearch(task, route.input?.query as string | undefined, onChunk);
  } else if (isCodingRequest(task)) {
    // Code / repair work → the agent-based IDE coding team (chat stays the
    // command surface; /ide is where the team works visibly). Checked BEFORE
    // needs_confirmation so code work always spawns a team.
    resultText = await handleCodingTask(task, metadata, onChunk);
  } else if (routeResult.needs_confirmation) {
    status = 'needs_confirmation';
    resultText =
      `I'm ${(route.confidence * 100).toFixed(0)}% confident this should go to ` +
      `"${route.entity_slug ?? route.chain_slug ?? 'unknown'}". ` +
      `Please confirm or give me more detail.`;
    await streamText(resultText, onChunk);
  } else {
    // Low confidence / decompose / memory / unknown → general agent fallback
    resultText = await dispatchToUplift(task, metadata);
    await streamText(resultText, onChunk);
  }

  await appendAuditLog({
    event: 'chat_complete',
    intent: route.intent,
    entity_slug,
    chain_slug,
    status,
    agent: 'draymond',
  });

  // Observability: emit a Langfuse trace for this turn (no-op when unconfigured).
  ingestTraceAsync({
    id: traceId,
    name: 'chat_turn',
    timestamp: new Date(traceStartMs).toISOString(),
    sessionId: typeof metadata.session_id === 'string' ? metadata.session_id : undefined,
    userId: typeof metadata.user_id === 'string' ? metadata.user_id : undefined,
    input: task.slice(0, 2000),
    output: resultText.slice(0, 2000),
    metadata: {
      intent: route.intent,
      confidence: route.confidence,
      entity_slug,
      chain_slug,
      status,
      duration_ms: Date.now() - traceStartMs,
    },
  });

  return {
    result: resultText,
    status,
    route,
    entity_slug,
    chain_slug,
  };
}
