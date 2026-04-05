/**
 * POST /api/v1/orchestrate
 * Open-Chat companion streaming orchestration endpoint.
 *
 * Accepts a task from Open-Chat's DraymondOrchestratorClient and streams
 * back an OpenAI-compatible SSE response while dispatching the task to
 * Draymond's Uplift agent backend.
 *
 * Request body (JSON):
 *   { workflow_id: string, task: string, stream?: boolean, metadata?: object }
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

export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const bodyResult = await parseJsonBody<{
    workflow_id?: string;
    task?: string;
    stream?: boolean;
    metadata?: Record<string, unknown>;
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

      // Dispatch to Uplift with a timeout — pass the abort signal through
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLIFT_TIMEOUT_MS);

      let resultText = '';
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

        // Extract text from various possible Uplift response shapes
        const r = result as Record<string, unknown>;
        resultText =
          (typeof r?.content === 'string' ? r.content : null) ??
          (typeof r?.output === 'string' ? r.output : null) ??
          (typeof r?.result === 'string' ? r.result : null) ??
          (typeof r?.message === 'string' ? r.message : null) ??
          JSON.stringify(result);
      } catch (upliftErr) {
        clearTimeout(timer);
        // Sanitise error — never leak internal Uplift details to the client
        const isTimeout = upliftErr instanceof DOMException && upliftErr.name === 'AbortError';
        resultText = isTimeout
          ? `[Draymond] Task received: "${task}"\n\nThe request timed out. The task has been logged and will be retried.`
          : `[Draymond] Task received: "${task}"\n\nUplift agent is currently unavailable. The task has been logged and will be retried when the agent is back online.`;

        await appendAuditLog({
          event: 'open_chat_orchestrate_uplift_error',
          workflow_id: workflowId,
          error: upliftErr instanceof Error ? upliftErr.message : String(upliftErr),
          agent: 'draymond',
        });
      }

      // Stream the result in chunks so Open-Chat sees a streaming response
      const CHUNK_SIZE = 20;
      for (let i = 0; i < resultText.length; i += CHUNK_SIZE) {
        await write(sseChunk(resultText.slice(i, i + CHUNK_SIZE)));
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
