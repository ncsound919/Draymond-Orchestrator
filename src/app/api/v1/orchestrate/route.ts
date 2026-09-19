/**
 * POST /api/v1/orchestrate
 * Open-Chat companion streaming orchestration endpoint.
 *
 * Accepts a task from Open-Chat's DraymondOrchestratorClient and streams
 * back an OpenAI-compatible SSE response while dispatching the task to
 * Draymond's Uplift agent backend, a registered entity, or a chain.
 *
 * Request body (JSON):
 *   { workflow_id: string, task: string, stream?: boolean, metadata?: object,
 *     entity_slug?: string, chain_slug?: string, auto_route?: boolean,
 *     build_chain?: boolean }
 *
 * Routing (upgraded with Intelligent Task Router):
 *   - entity_slug provided → invoke the matching Draymond entity
 *   - chain_slug provided  → instantiate and execute the chain
 *   - build_chain: true    → use Dynamic Chain Builder to create & run a chain
 *   - auto_route: true     → use Intelligent Router to classify & dispatch
 *   - neither              → dispatch to Uplift (default fallback)
 *
 * Response: text/event-stream (SSE)
 *   data: { choices: [{ delta: { content: "..." } }] }
 *   data: [DONE]
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { appendAuditLog } from '@/lib/audit';
import { dispatchTask } from '@/lib/uplift';
import { getEntity } from '@/lib/draymond/registry';
import { invokeEntity } from '@/lib/draymond/invoker';
import { instantiateChain, executeChain } from '@/lib/draymond/chains';
import { routeAndClassify } from '@/lib/draymond/router';
import { logExecution } from '@/lib/draymond/confidence';
import { processEvent } from '@/lib/draymond/reactive';
import { buildAndExecuteChain } from '@/lib/draymond/chain-builder';
import { humanizeResponse } from '@/lib/draymond/chat-polish';
import { getDashboardSummary, submitAction } from '@/lib/draymond/index';
import {
  AETHERDESK_OPERATIONS,
  executeAetherDeskOperation,
  getOperationRisk,
  resolveAetherDeskAgentId,
} from '@/lib/draymond/aetherdesk';

export const dynamic = 'force-dynamic';

/** Max milliseconds to wait for Uplift to respond before timing out. */
const UPLIFT_TIMEOUT_MS = 60_000;

/** Workflow ID must be alphanumeric, hyphens, underscores (max 128 chars). */
const WORKFLOW_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function sseChunk(content: string): string {
  const payload = JSON.stringify({
    choices: [{ delta: { content }, finish_reason: null }],
  });
  return `data: ${payload}\n\n`;
}

function sseDone(): string {
  return 'data: [DONE]\n\n';
}

function sseWorkflow(workflowId: string, update: Record<string, unknown>): string {
  const payload = JSON.stringify({
    workflow: { id: workflowId, ...update },
    choices: [{ delta: { content: '' }, finish_reason: null }],
  });
  return `data: ${payload}\n\n`;
}

// -- Extracted handler functions ----------------------------------------------

async function handleEntityInvocation(
  slug: string,
  metadata: Record<string, unknown>,
  write: (chunk: string) => Promise<void>,
  fallbackTask?: string
): Promise<string> {
  const entity = await getEntity(slug);
  if (!entity) {
    await write(sseChunk(`[Draymond] Entity "${slug}" not found.`));
    return `[Draymond] Entity "${slug}" not found.`;
  }

  const action = (metadata.action as string) ?? 'default';
  const input = { ...((metadata.input as Record<string, unknown>) ?? {}) };

  // For a plain chat routed to an entity with no explicit action/input, hand
  // the raw task text to the entity's default endpoint (e.g. /task) so the
  // agent can actually answer instead of 404ing on an empty body.
  if ((action === 'default' || action === 'chat' || action === 'task') &&
      typeof fallbackTask === 'string' && fallbackTask.trim() &&
      typeof input.description !== 'string') {
    input.description = fallbackTask.trim();
    input.task = fallbackTask.trim();
  }
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

    const durationMs = Date.now() - startMs;

    // Log execution for adaptive confidence scoring
    logExecution({
      entity_id: entity.id,
      entity_slug: entity.slug,
      action,
      success: result.success,
      duration_ms: durationMs,
      input_summary: JSON.stringify(input).slice(0, 500),
      output_summary: result.success ? JSON.stringify(result.output).slice(0, 500) : '',
      error_message: result.success ? undefined : result.error,
    }).catch(() => {});

    return result.success
      ? JSON.stringify(result.output)
      : `[Draymond] Entity invocation failed: ${result.error}`;
  } catch (entityErr) {
    const durationMs = Date.now() - startMs;

    logExecution({
      entity_id: entity.id,
      entity_slug: entity.slug,
      action,
      success: false,
      duration_ms: durationMs,
      error_message: entityErr instanceof Error ? entityErr.message : String(entityErr),
    }).catch(() => {});

    return `[Draymond] Entity invocation error: ${entityErr instanceof Error ? entityErr.message : String(entityErr)}`;
  }
}

/**
 * AetherDesk invocation special-case.
 * Low/medium-risk operations execute immediately. High/critical operations
 * are submitted through the confidence gate (clamped to 0.8, which always
 * yields queue_for_review) and then executed asynchronously after the user
 * approves the ntfy notification.
 */
async function handleAetherDeskInvocation(
  slug: string,
  metadata: Record<string, unknown>,
  write: (chunk: string) => Promise<void>
): Promise<string> {
  const action = typeof metadata.action === 'string' ? metadata.action : '';
  const input = (metadata.input as Record<string, unknown>) ?? {};
  const risk = getOperationRisk(action);

  if (!risk) {
    const supported = Object.keys(AETHERDESK_OPERATIONS).join(', ');
    const msg = `[Draymond] Unknown AetherDesk operation "${action}". Supported: ${supported}`;
    await write(sseChunk(`${msg}\n`));
    return msg;
  }

  if (risk === 'low' || risk === 'medium') {
    const result = await executeAetherDeskOperation(action, input);
    return result.success
      ? JSON.stringify(result.output)
      : `[Draymond] AetherDesk operation failed: ${result.error}`;
  }

  // high/critical → human approval via ntfy
  const agentId = await resolveAetherDeskAgentId();
  if (!agentId) {
    const msg = '[Draymond] AetherDesk control agent is not registered — apply migration 009.';
    await write(sseChunk(`${msg}\n`));
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

  const msg = '[Draymond] High-risk AetherDesk order queued for approval — check your phone.';
  await write(sseChunk(`${msg}\n`));
  return `${msg} (action ${submitted.id})`;
}

async function handleChainExecution(
  slug: string,
  metadata: Record<string, unknown>
): Promise<string> {
  try {
    const chainInput = (metadata.input as Record<string, unknown>) ?? {};
    const agentId = metadata.agent_id as string | undefined;
    const instance = await instantiateChain(slug, chainInput, undefined, agentId);
    const ctx = await executeChain(instance.id, agentId);
    return JSON.stringify({ chain_id: instance.id, context: ctx.context, steps: ctx.steps });
  } catch (chainErr) {
    return `[Draymond] Chain execution error: ${chainErr instanceof Error ? chainErr.message : String(chainErr)}`;
  }
}

async function handleUpliftDispatch(
  workflowId: string,
  task: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLIFT_TIMEOUT_MS);

  try {
    const result = await dispatchTask(
      {
        task_id: workflowId,
        description: task,
        agent: 'uplift',
        context: metadata,
        session_id: `openchat-${randomUUID()}`,
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
      event: 'open_chat_orchestrate_uplift_error',
      workflow_id: workflowId,
      error: upliftErr instanceof Error ? upliftErr.message : String(upliftErr),
      agent: 'draymond',
    });

    return isTimeout
      ? `[Draymond] Task received: "${task}"\n\nThe request timed out. The task has been logged and will be retried.`
      : `[Draymond] Task received: "${task}"\n\nUplift agent is currently unavailable. The task has been logged and will be retried when the agent is back online.`;
  }
}

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    workflow_id?: string;
    task?: string;
    stream?: boolean;
    metadata?: Record<string, unknown>;
    entity_slug?: string;
    chain_slug?: string;
    auto_route?: boolean;
    build_chain?: boolean;
  }>(request);
  if (bodyResult.error) return bodyResult.error;

  const body = bodyResult.data;
  const task = typeof body.task === 'string' ? body.task.trim() : '';
  if (!task) {
    return new Response(
      JSON.stringify({ error: 'task is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate or generate workflow ID
  let workflowId: string;
  if (typeof body.workflow_id === 'string' && body.workflow_id.trim()) {
    const trimmed = body.workflow_id.trim();
    if (!WORKFLOW_ID_RE.test(trimmed)) {
      return new Response(
        JSON.stringify({ error: 'Invalid workflow_id format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    workflowId = trimmed;
  } else {
    workflowId = `wf-${randomUUID()}`;
  }

  // Validate metadata is a plain object (not an array or primitive)
  const metadata: Record<string, unknown> =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {};

  const entity_slug = typeof body.entity_slug === 'string' ? body.entity_slug.trim() || undefined : undefined;
  const chain_slug = typeof body.chain_slug === 'string' ? body.chain_slug.trim() || undefined : undefined;
  const auto_route = body.auto_route === true;
  const build_chain = body.build_chain === true;

  await appendAuditLog({
    event: 'open_chat_orchestrate_start',
    workflow_id: workflowId,
    task_preview: task.slice(0, 200),
    agent: 'draymond',
  });

  // Build a streaming response using TransformStream so we can write SSE
  // events as the task progresses and flush them to the client in real time.
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const write = (chunk: string) => writer.write(encoder.encode(chunk));

  // Run the orchestration in the background so we can return the Response
  // immediately (required for streaming in Next.js App Router).
  (async () => {
    try {
      // Announce workflow start
      await write(sseWorkflow(workflowId, { status: 'in_progress', startTime: Date.now() }));

      let resultText = '';

      if (entity_slug) {
        // -- Entity invocation path (explicit slug) -----------------
        resultText = entity_slug === 'aetherdesk'
          ? await handleAetherDeskInvocation(entity_slug, metadata, write)
          : await handleEntityInvocation(entity_slug, metadata, write);
      } else if (chain_slug) {
        // -- Chain execution path (explicit slug) -------------------
        resultText = await handleChainExecution(chain_slug, metadata);
      } else if (build_chain) {
        // -- Dynamic Chain Builder path -----------------------------
        await write(sseChunk('[Draymond] Building chain from description...\n'));
        try {
          const buildResult = await buildAndExecuteChain({ description: task, context: metadata });
          if (buildResult.executed) {
            resultText = JSON.stringify({
              status: 'chain_built_and_executed',
              chain_id: buildResult.build.chain_id,
              blueprint: buildResult.build.blueprint.name,
              steps: buildResult.build.blueprint.steps.length,
              confidence: buildResult.build.blueprint.confidence,
            });
          } else {
            resultText = JSON.stringify({
              status: 'chain_built_not_executed',
              blueprint: buildResult.build.blueprint,
              validation: buildResult.build.validation,
              error: buildResult.execution_error,
            });
          }
        } catch (buildErr) {
          resultText = `[Draymond] Chain builder error: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`;
        }
      } else if (auto_route) {
        // -- Intelligent Task Router path ---------------------------
        try {
          const routeResult = await routeAndClassify(task, metadata);
          const route = routeResult.route;

          if (routeResult.should_auto_execute && route.intent === 'invoke_entity' && route.entity_slug) {
            const merged = {
              ...metadata,
              action: route.action,
              input: route.input,
            };
            resultText = route.entity_slug === 'aetherdesk'
              ? await handleAetherDeskInvocation(route.entity_slug, merged, write)
              : await handleEntityInvocation(route.entity_slug, merged, write, task);
          } else if (routeResult.should_auto_execute && route.intent === 'execute_chain' && route.chain_slug) {
            resultText = await handleChainExecution(route.chain_slug, {
              ...metadata,
              input: route.input,
            });
          } else if (route.intent === 'query_status') {
            const summary = await getDashboardSummary();
            resultText = JSON.stringify(summary);
          } else if (route.intent === 'casual_chat') {
            resultText = await handleUpliftDispatch(workflowId, task, metadata);
          } else if (route.intent === 'decompose_goal' || routeResult.needs_decomposition) {
            // Fall through to Uplift for complex decomposition
            resultText = await handleUpliftDispatch(workflowId, task, metadata);
          } else if (routeResult.needs_confirmation) {
            // Confidence not high enough — ask the user to confirm in plain language
            resultText = `I think you want me to ${route.entity_slug ? `ask ${route.entity_slug} to handle this` : route.chain_slug ? `run the "${route.chain_slug}" workflow` : 'handle this'}. Is that right? Or tell me a bit more about what you need.`;
          } else {
            // Low confidence or unknown — fall back to Uplift
            resultText = await handleUpliftDispatch(workflowId, task, metadata);
          }
        } catch (routeErr) {
          // Router failed — fall back to Uplift
          console.error('[orchestrate] Router error, falling back to Uplift:', routeErr);
          resultText = await handleUpliftDispatch(workflowId, task, metadata);
        }
      } else {
        // -- Uplift dispatch path (default fallback) ----------------
        resultText = await handleUpliftDispatch(workflowId, task, metadata);
      }

      // Fire reactive event for orchestration completion
      processEvent('orchestrate.completed', 'orchestrate-route', {
        workflow_id: workflowId,
        task: task.slice(0, 200),
        entity_slug,
        chain_slug,
        auto_route,
        build_chain,
      }).catch(() => {});

      // Humanize structured results before streaming so the phone shows a
      // conversational reply instead of a raw JSON dump.
      const polished = await humanizeResponse(resultText, { userTask: task });

      // Stream the result in chunks so Open-Chat sees a streaming response
      const CHUNK_SIZE = 20;
      for (let i = 0; i < polished.length; i += CHUNK_SIZE) {
        await write(sseChunk(polished.slice(i, i + CHUNK_SIZE)));
      }

      // Announce workflow completion
      await write(
        sseWorkflow(workflowId, { status: 'completed', endTime: Date.now() }),
      );
      await write(sseDone());

      await appendAuditLog({
        event: 'open_chat_orchestrate_complete',
        workflow_id: workflowId,
        agent: 'draymond',
      });
    } catch (err) {
      // Generic error — never leak internals
      console.error('[orchestrate] stream error:', err);
      await write(sseChunk('\n\nAn unexpected error occurred during orchestration.'));
      await write(sseDone());
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
