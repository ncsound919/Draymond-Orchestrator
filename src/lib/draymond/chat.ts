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
import { enqueueWorkerTask } from './worker-tasks';
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
const COMPRESS_THRESHOLD = 12;

// ── Small-talk / greeting detection ──────────────────────────────────────────
// Low-value messages that don't warrant dispatching an agent. Routed to a
// friendly conversational reply instead of a down agent's "will retry" dead-end.
const SMALL_TALK_RE =
  /^(?:hey|hi|hello|yo|sup|whats up|what's up|how are you|how's it going|how are things|good (?:morning|afternoon|evening)|morning|evening|thanks|thank you|ty|thx|ok|okay|k|done|nice|great|awesome|lol|haha)\b[\s\S]{0,40}$/i;

function isSmallTalk(task: string): boolean {
  return SMALL_TALK_RE.test(task.trim());
}

// ── Diagnostic signal detection ──────────────────────────────────────────────
// Messages about failures/downtime should trigger the diagnostic + repair +
// self-learning loop, not a blind "will retry".
const DIAGNOSTIC_RE =
  /\b(?:down|unavailable|failed|failing|broken|crash|timeout|error|offline|not working|outage|degraded|stuck|retry|repair|fix)\b/i;

function isDiagnosticQuery(task: string): boolean {
  return DIAGNOSTIC_RE.test(task);
}

// ── Coding-team dispatch ─────────────────────────────────────────────────────

/** Loose signal that a task is code work rather than an entity/chain/query. */
const CODING_REQUEST_RE =
  /(fix|repair|debug|refactor|rewrite|implement|build|create|write|add|generate|restructure|clean up|compile|typecheck|upgrade|migrate|regression)\b[\s\S]{0,80}\b(code|app|api|service|function|module|component|endpoint|script|config|repo|project|feature|bug|error|crash|timeout|issue|tests?|build)/i;

function isCodingRequest(task: string): boolean {
  return CODING_REQUEST_RE.test(task);
}

// ── On-device dispatch ───────────────────────────────────────────────────────

/** Loose signal that a task should run on the user's phone (Open-Chat worker). */
const ON_DEVICE_RE =
  /\b(?:on (?:my |the )?(?:phone|device)|open (?:the )?(?:whatsapp|telegram|instagram|messages?|camera|music|maps?|calendar|gmail|email app|chrome|youtube|spotify|notes?)\b|\bscreenshot\b|\btake a picture\b|\bcapture (?:the |a )?(?:screen|photo)\b|\bremind(?: me|er)?\b|\bset (?:a |an )?(?:reminder|alarm|timer)\b|\bcheck (?:my )?(?:phone )?notifications?\b|\bphone battery\b|\bphone status\b)/i;

function isOnDeviceRequest(task: string): boolean {
  return ON_DEVICE_RE.test(task);
}

/**
 * Queue an on-device task to the Open-Chat worker via the worker-task queue.
 * Open Chat pulls it, executes the on_device_ops skill pack on the phone
 * (phone control / capture / local AI), and reports the result back.
 */
async function handleOnDeviceTask(
  task: string,
  metadata: Record<string, unknown>,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  await emit(onChunk, '\nQueueing to your phone…\n\n');

  try {
    const taskId = await enqueueWorkerTask({
      skill_pack_id: 'on_device_ops:1.0.0',
      payload: {
        task,
        request: task,
        source: 'dashboard-chat',
        user_id: typeof metadata.user_id === 'string' ? metadata.user_id : undefined,
      },
    });

    const msg =
      '📱 Queued to your phone — Open-Chat will execute it and report back ' +
      `(task ${taskId}). Watch the Open-Chat Work screen for progress.`;
    await streamText(msg, onChunk);
    return msg;
  } catch (err) {
    const msg = `Could not queue the on-device task: ${err instanceof Error ? err.message : String(err)}`;
    await streamText(msg, onChunk);
    return msg;
  }
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
// Context helpers (memory, follow-ups, compression, vision)
// ---------------------------------------------------------------------------

export interface ChatExtraContext {
  conversation?: ChatMessage[];
  metadata?: Record<string, unknown>;
}

/** Map chat metadata attachments into the LLM `images` shape. */
function extractImages(metadata: Record<string, unknown>): Array<{ dataB64: string; mediaType: string }> {
  const raw = Array.isArray(metadata.attachments) ? metadata.attachments : [];
  return raw
    .filter(
      (a): a is { dataB64: string; mimeType: string } =>
        !!a && typeof (a as { dataB64?: string }).dataB64 === 'string' && typeof (a as { mimeType?: string }).mimeType === 'string',
    )
    .map((a) => ({ dataB64: a.dataB64, mediaType: a.mimeType }));
}

/** Recent conversation (last N turns) flattened for LLM prompts. */
function buildConversationBlock(conversation: ChatMessage[] | undefined, limit = 6): string {
  if (!conversation?.length) return '';
  const recent = conversation.slice(-limit);
  return recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 800)}`)
    .join('\n');
}

/** Long-term memory relevant to the current task, if any. */
async function loadMemoryContext(
  task: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const userId = metadata.user_id;
  if (!userId) return '';
  try {
    const { searchMemories } = await import('./memory-intelligence');
    const memories = await searchMemories('draymond', String(userId), task, {
      limit: 8,
      min_importance: 0.3,
    });
    if (memories.length === 0) return '';
    return memories
      .map((m) => {
        const label = m.memory.summary ?? JSON.stringify(m.memory.value).slice(0, 200);
        return `- ${m.memory.key}: ${label}`;
      })
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Compress older turns into a compact summary when a transcript grows past
 * `threshold` messages, so long conversations keep earlier context without
 * blowing the token budget. Falls back to keeping the tail on LLM failure.
 */
async function compressConversation(
  conversation: ChatMessage[],
  threshold = 12,
): Promise<ChatMessage[]> {
  if (conversation.length <= threshold) return conversation;
  const recent = conversation.slice(-threshold);
  const older = conversation.slice(0, -threshold);
  const olderText = older
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  try {
    const summary = await callLLM({
      system:
        'You are a conversation summarizer for Draymond. Summarize the earlier part of this conversation into a compact paragraph that preserves names, decisions, and any facts the user mentioned. Use "earlier in this conversation" framing.',
      userMessage: olderText.slice(0, 12_000),
      maxTokens: 220,
      temperature: 0.2,
      fallbackKey: 'chat.compressConversation',
      localFirst: true,
    });
    return [
      { role: 'assistant' as const, content: `[Earlier in this conversation: ${summary.trim()}]` },
      ...recent,
    ];
  } catch {
    return [...older.slice(-4), ...recent];
  }
}

/**
 * Direct conversational answer — the Claude/ChatGPT-style general path.
 * Grounds the reply in the recent conversation, long-term memory, and (when
 * the user attaches images) vision. Throws when no LLM provider is available
 * so the caller can fall back to the Uplift agent.
 */
async function handleGeneralChat(
  task: string,
  extra: ChatExtraContext,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  const metadata = extra.metadata ?? {};
  const images = extractImages(metadata);
  const conversationBlock = buildConversationBlock(extra.conversation);
  const memoryBlock = await loadMemoryContext(task, metadata);

  if (images.length > 0) {
    await emit(onChunk, '\nLooking at your image…\n\n');
  }

  const system = [
    "You are Draymond, an intelligent assistant and the orchestrator running this business's agent ecosystem.",
    'You answer questions directly and helpfully — clearly, specifically, and honestly. If you are not sure, say so.',
    'You can run entities and chains, check system status, search the web, and dispatch repairs when asked.',
    'Use the provided conversation context and memory to answer; treat earlier turns as established facts.',
    'Be concise but complete. Use markdown (headings, lists, code blocks) when it improves readability.',
  ].join(' ');

  const sections: string[] = [];
  if (conversationBlock) sections.push(`<recent_conversation>\n${conversationBlock}\n</recent_conversation>`);
  if (memoryBlock) sections.push(`<memory>\n${memoryBlock}\n</memory>`);
  sections.push(`<user_message>\n${task}\n</user_message>`);

  const answer = await callLLM({
    system,
    userMessage: sections.join('\n\n'),
    images: images.length ? images : undefined,
    maxTokens: 1500,
    temperature: 0.4,
    fallbackKey: 'chat.handleGeneralChat',
    localFirst: true,
  });

  await streamText(answer, onChunk);
  return answer;
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

    // The task WAS logged for retry, but instead of a dead-end "will retry"
    // reply, run a quick diagnostic + surface self-learning so the user gets a
    // useful answer now. Record the failure as an outcome too (learning loop).
    try {
      const { recordOutcome } = await import('./self-learning');
      await recordOutcome({
        agentId: 'chat:uplift',
        kind: 'incident',
        summary: `uplift fallback unavailable for "${task.slice(0, 80)}"`,
        success: false,
        detail: isTimeout ? 'timed out' : (upliftErr instanceof Error ? upliftErr.message : String(upliftErr)),
      });
    } catch { /* learning store best-effort */ }

    return handleDiagnostic(task, {}, () => {}).then(
      (diag) =>
        `I tried to dispatch that to the Uplift agent, but it's ${isTimeout ? 'not responding' : 'currently unavailable'}.\n\n${diag}`,
    );
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
  extra: ChatExtraContext,
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

  const conversationBlock = buildConversationBlock(extra.conversation);
  const memoryBlock = await loadMemoryContext(task, extra.metadata ?? {});
  const contextBlock = [conversationBlock && `<recent_conversation>\n${conversationBlock}\n</recent_conversation>`, memoryBlock && `<memory>\n${memoryBlock}\n</memory>`]
    .filter(Boolean)
    .join('\n\n');

  try {
    const answer = await callLLM({
      system: SYSTEM_INTEL_SYSTEM_PROMPT,
      userMessage: `Question: ${task}\n\n${contextBlock ? `${contextBlock}\n\n` : ''}<system_snapshot>\n${snapshot}\n</system_snapshot>`,
      maxTokens: 2000,
      temperature: 0.2,
      localFirst: true,
      fallbackKey: 'chat.querySystemStatus',
      fallbackContext: { snapshot },
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
 * Diagnostic & repair reply — for messages about failures/downtime.
 * Runs a live health pass (services + monitors + failing jobs), pulls distilled
 * self-learning lessons for the affected components, and surfaces what's
 * actually being repaired (repair team + heartbeat sweep run on cron). Falls
 * back to the deterministic system snapshot if the LLM is unavailable.
 */
async function handleDiagnostic(
  task: string,
  extra: ChatExtraContext,
  onChunk: ChatTurnOptions['onChunk'],
): Promise<string> {
  await emit(onChunk, '\nRunning diagnostics…\n\n');

  const sections: string[] = [];
  const repairHints: string[] = [];

  try {
    const { probeAllServices } = await import('./service-manager');
    const down = (await probeAllServices()).filter((s) => !s.up);
    sections.push(
      down.length === 0
        ? 'All monitored services are up.'
        : `Services down (${down.length}): ${down.map((s) => `${s.slug} (${s.detail})`).slice(0, 8).join(', ')}`
    );
  } catch { /* probe best-effort */ }

  try {
    const { auditApiKeys, missingCriticalKeys } = await import('./api-keys');
    const audit = auditApiKeys();
    sections.push(`API keys: ${audit.configured} configured, ${audit.missing} missing, ${audit.noKey} keyless.`);
    const critical = missingCriticalKeys(5);
    if (critical.length > 0) {
      sections.push(`Missing mission keys: ${critical.map((k) => k.name).join(', ')} — add to .env.local.`);
    }
  } catch { /* keys best-effort */ }

  try {
    const { getLessons } = await import('./self-learning');
    const lessons = await getLessons();
    if (lessons.length > 0) {
      const top = lessons.slice(0, 4).map((l) => `- ${l.lesson} (x${l.evidenceCount})`).join('\n');
      sections.push(`Lessons learned (self-learning):\n${top}`);
    } else {
      sections.push('No distilled lessons yet — the learning loop will cluster outcomes after a few runs.');
    }
    const relevant = lessons.filter((l) => DIAGNOSTIC_RE.test(l.lesson));
    if (relevant.length > 0) {
      repairHints.push(...relevant.slice(0, 3).map((l) => l.lesson));
    }
  } catch { /* lessons best-effort */ }

  try {
    const { listJobs } = await import('./scheduler');
    const failed = (await listJobs()).filter((j) => j.last_run_status === 'failed');
    if (failed.length > 0) {
      sections.push(`Failed scheduled jobs (${failed.length}): ${failed.slice(0, 5).map((j) => `${j.name} — ${(j.last_error ?? '').slice(0, 80)}`).join(' | ')}`);
    }
  } catch { /* jobs best-effort */ }

  const snapshot = sections.join('\n\n');
  const message = [
    `Here's what I found on the current system state:\n\n${snapshot}`,
    '',
    'The repair team scans failures hourly and the heartbeat sweep restarts down services automatically. ' +
      'Lessons are distilled nightly so the same mistake is not repeated.',
    repairHints.length > 0
      ? `\nRelevant prior lessons:\n${repairHints.map((h) => `- ${h}`).join('\n')}`
      : '',
    '',
    'Want me to run the repair team now, or dig into a specific failure?',
  ].join('\n');

  // Try an LLM-grounded answer, else fall back to the deterministic summary.
  const conversationBlock = buildConversationBlock(extra.conversation);
  const memoryBlock = await loadMemoryContext(task, extra.metadata ?? {});
  const contextBlock = [conversationBlock && `<recent_conversation>\n${conversationBlock}\n</recent_conversation>`, memoryBlock && `<memory>\n${memoryBlock}\n</memory>`]
    .filter(Boolean)
    .join('\n\n');

  try {
    const answer = await callLLM({
      system:
        "You are Draymond, the orchestrator. The user reports a failure or downtime. Ground your answer ONLY in the provided diagnostic snapshot. Summarize what's down, cite the self-learning lessons, and state that the repair team + heartbeat sweep are handling it automatically. Be concise and specific.",
      userMessage: `Report: ${task}\n\n${contextBlock ? `${contextBlock}\n\n` : ''}<diagnostics>\n${snapshot}\n</diagnostics>`,
      maxTokens: 700,
      temperature: 0.2,
      fallbackKey: 'chat.handleDiagnostic',
      fallbackContext: { snapshot },
      localFirst: true,
    });
    await streamText(answer, onChunk);
    return answer;
  } catch {
    await streamText(message, onChunk);
    return message;
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
      fallbackKey: 'chat.synthesizeSearchAnswer',
      fallbackContext: { sources },
      localFirst: true,
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
  // "also check X") resolve against earlier turns. Long transcripts are
  // compressed so early context survives without blowing the token budget.
  let conversation = (options.conversation ?? []).slice(-24);
  if (conversation.length > COMPRESS_THRESHOLD) {
    conversation = await compressConversation(conversation);
  }
  const routerContext: Record<string, unknown> = {
    ...metadata,
    conversation: conversation.length > 0 ? conversation : undefined,
  };
  const chatExtra: ChatExtraContext = { conversation, metadata };

  await appendAuditLog({
    event: 'chat_start',
    task_preview: task.slice(0, 200),
    agent: 'draymond',
  });

  // Small talk / greetings — no agent dispatch needed. A conversational reply
  // beats routing "yo" to a down agent and getting a "will retry" dead-end.
  if (isSmallTalk(task)) {
    const greetings = [
      "Yo — I'm here. Ask me to run something, check system status, or dig into a failure. Type `help` for what I can do.",
      "What's up. I can run agents, check health, query the knowledge graph, or route a repair. What do you need?",
      "Hey. System's being watched — crons, monitors, repairs, and the brain are all wired. What's on your mind?",
    ];
    const reply = greetings[Math.floor(Math.random() * greetings.length)];
    await streamText(reply, onChunk);
    return { result: reply, status: 'completed' };
  }

  const routeResult = await routeAndClassify(task, routerContext);
  const route = routeResult.route;

  const routeTarget =
    route.entity_slug ??
    route.chain_slug ??
    (route.intent === 'web_search' ? 'web' : route.intent === 'query_status' ? 'system' : 'general');
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
    resultText = await querySystemStatus(task, chatExtra, onChunk);
  } else if (route.intent === 'web_search') {
    resultText = await handleWebSearch(task, route.input?.query as string | undefined, onChunk);
  } else if (isOnDeviceRequest(task)) {
    // Phone/device work → enqueue to the Open-Chat worker (runs on-device).
    resultText = await handleOnDeviceTask(task, metadata, onChunk);
  } else if (isCodingRequest(task)) {
    // Code / repair work → the agent-based IDE coding team (chat stays the
    // command surface; /ide is where the team works visibly). Checked BEFORE
    // needs_confirmation so code work always spawns a team.
    resultText = await handleCodingTask(task, metadata, onChunk);
  } else if (isDiagnosticQuery(task)) {
    // Failure/downtime reports → the diagnostic + repair + self-learning loop.
    resultText = await handleDiagnostic(task, chatExtra, onChunk);
  } else if (routeResult.needs_confirmation) {
    status = 'needs_confirmation';
    resultText =
      `I'm ${(route.confidence * 100).toFixed(0)}% confident this should go to ` +
      `"${route.entity_slug ?? route.chain_slug ?? 'unknown'}". ` +
      `Please confirm or give me more detail.`;
    await streamText(resultText, onChunk);
  } else {
    // Low confidence / decompose / memory / unknown → direct conversational
    // answer (Claude/ChatGPT-style), grounded in memory + recent conversation
    // + vision when images are attached. Falls back to the Uplift agent when
    // the LLM chain is unavailable.
    try {
      resultText = await handleGeneralChat(task, chatExtra, onChunk);
    } catch (err) {
      console.warn('[chat] general path unavailable, falling back to Uplift:', err instanceof Error ? err.message : String(err));
      resultText = await dispatchToUplift(task, metadata);
      await streamText(resultText, onChunk);
    }
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
