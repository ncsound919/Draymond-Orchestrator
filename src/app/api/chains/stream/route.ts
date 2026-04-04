/**
 * GET /api/chains/stream?chain_id=<chain_id>
 *
 * Server-Sent Events stream for real-time chain execution progress.
 * Polls draymond_chains and draymond_chain_steps tables every 2s
 * and emits events when chain or step statuses change.
 *
 * Events emitted:
 *   event: chain   — chain-level status change (running, completed, etc.)
 *   event: step    — individual step status change
 *   event: done    — chain reached terminal state (completed/failed/cancelled)
 *   event: error   — polling or validation errors
 *
 * Auth: Bearer token via CRON_SECRET (authorizeRequest).
 * Client: uses createDraymondAdminClient (service role, no cookies).
 */

import { NextRequest } from 'next/server';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';
import { createDraymondAdminClient } from '@/lib/draymond/client';

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_DURATION_MS = 30 * 60 * 1000; // 30 minutes
/** Maximum concurrent SSE connections allowed (item 33). */
const MAX_CONCURRENT_STREAMS = 50;
/** Current number of active SSE streams. */
let _activeStreams = 0;

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// ---------------------------------------------------------------------------
// Row shapes (untyped Supabase client, so we cast manually)
// ---------------------------------------------------------------------------

interface ChainRow {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  total_duration_ms: number | null;
  updated_at: string;
}

interface StepRow {
  id: string;
  chain_id: string;
  step_order: number;
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // 1. Validate query param
  const chainId = request.nextUrl.searchParams.get('chain_id');
  if (!chainId) {
    return new Response(
      JSON.stringify({ error: 'Missing required query parameter: chain_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Validate chain_id format — must be a UUID (item 34)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(chainId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid chain_id format: must be a UUID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 2. Auth check
  const authError = authorizeRequest(request);
  if (authError) return authError;

  // 3. Connection cap (item 33)
  if (_activeStreams >= MAX_CONCURRENT_STREAMS) {
    return new Response(
      JSON.stringify({ error: 'Too many concurrent SSE connections' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 4. Admin client (synchronous, no cookies)
  const supabase = createDraymondAdminClient();

  // 5. Build SSE stream
  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  /** Track how many consecutive "not found" errors to prevent 30-min polling on nonexistent chains (item 38). */
  const MAX_NOT_FOUND_ERRORS = 5;

  const stream = new ReadableStream({
    async start(controller) {
      _activeStreams++;

      // Helper: enqueue an SSE frame
      const send = (event: string, data: object) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const deadline = Date.now() + MAX_POLL_DURATION_MS;
      let notFoundCount = 0;

      // Track last-seen statuses so we only emit on changes
      let seenChainStatus = '';
      const seenStepStatuses: Record<string, string> = {};

      // -------------------------------------------------------------------
      // Poll loop
      // -------------------------------------------------------------------
      try {
      while (Date.now() < deadline) {
        // Respect client disconnection
        if (abortSignal?.aborted) {
          controller.close();
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        // Check again after sleep
        if (abortSignal?.aborted) {
          controller.close();
          return;
        }

        try {
          // Fetch chain row
          const { data: chainData, error: chainError } = await supabase
            .from('draymond_chains')
            .select('id, status, started_at, completed_at, total_duration_ms, updated_at')
            .eq('id', chainId)
            .single();

          if (chainError || !chainData) {
            notFoundCount++;
            const errorMsg = sanitizeError(chainError?.message ?? 'Chain not found');
            send('error', {
              chain_id: chainId,
              error: errorMsg,
              timestamp: new Date().toISOString(),
            });
            // Stop polling after too many consecutive not-found errors (item 38)
            if (notFoundCount >= MAX_NOT_FOUND_ERRORS) {
              send('done', {
                chain_id: chainId,
                status: 'not_found',
                error: 'Chain not found after multiple attempts — closing stream',
              });
              controller.close();
              return;
            }
            continue;
          }

          // Reset not-found counter on successful fetch
          notFoundCount = 0;

          const chain = chainData as ChainRow;

          // Fetch steps for this chain, ordered
          const { data: stepsData, error: stepsError } = await supabase
            .from('draymond_chain_steps')
            .select(
              'id, chain_id, step_order, name, status, started_at, completed_at, duration_ms, error_message',
            )
            .eq('chain_id', chainId)
            .order('step_order', { ascending: true });

          if (stepsError) {
            send('error', {
              chain_id: chainId,
              error: sanitizeError(stepsError.message),
              timestamp: new Date().toISOString(),
            });
            continue;
          }

          const steps = (stepsData ?? []) as StepRow[];

          // Compute aggregate counts
          const totalSteps = steps.length;
          const completedSteps = steps.filter((s) => s.status === 'completed').length;
          const failedSteps = steps.filter((s) => s.status === 'failed').length;

          // ------ Emit step events for any status changes ------
          for (const step of steps) {
            if (seenStepStatuses[step.id] !== step.status) {
              seenStepStatuses[step.id] = step.status;

              // Don't emit for the initial "pending" unless it's all we have
              // (emit everything except the very first pending sighting to
              //  stay consistent with the pipeline/status pattern)
              send('step', {
                chain_id: chainId,
                step_id: step.id,
                step_name: step.name,
                step_order: step.step_order,
                status: step.status,
                duration_ms: step.duration_ms ?? null,
                timestamp: step.completed_at ?? step.started_at ?? new Date().toISOString(),
              });
            }
          }

          // ------ Emit chain event on status change ------
          if (chain.status !== seenChainStatus) {
            seenChainStatus = chain.status;

            send('chain', {
              chain_id: chainId,
              status: chain.status,
              completed_steps: completedSteps,
              failed_steps: failedSteps,
              total_steps: totalSteps,
              timestamp: chain.updated_at ?? new Date().toISOString(),
            });
          }

          // ------ Terminal state → emit done and close ------
          if (TERMINAL_STATUSES.has(chain.status)) {
            send('done', {
              chain_id: chainId,
              status: chain.status,
              completed_steps: completedSteps,
              total_steps: totalSteps,
              total_duration_ms: chain.total_duration_ms ?? null,
            });
            controller.close();
            return;
          }
        } catch (err) {
          send('error', {
            chain_id: chainId,
            error: sanitizeError(err),
            timestamp: new Date().toISOString(),
          });
          // Continue polling — transient errors shouldn't kill the stream
        }
      }

      // ------ Timeout ------
      send('error', {
        chain_id: chainId,
        error: 'Stream timed out after 30 minutes',
        timestamp: new Date().toISOString(),
      });
      controller.close();
      } finally {
        _activeStreams--;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
