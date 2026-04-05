/**
 * GET /api/v1/events
 * Open-Chat companion real-time SSE event stream.
 *
 * Streams Draymond orchestrator lifecycle events to the Open-Chat phone app
 * so it can update agent status, workflow progress, and tool execution state
 * in real time without polling.
 *
 * The stream sends:
 *   - A heartbeat ping every 15 s to keep the connection alive through proxies
 *   - agent.registered / agent.updated events when the agent list changes
 *   - workflow.started / workflow.completed / workflow.failed when tasks run
 *   - tool.executed when an agent runs a tool
 *
 * Because Next.js App Router runs in an Edge-compatible environment the event
 * bus is implemented as a simple in-process pub/sub using a shared Set of
 * WritableStream writers. In a multi-replica deployment you would replace this
 * with Redis Pub/Sub, Supabase Realtime, or similar.
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 * The token may alternatively be passed as ?token=... for SSE clients that
 * cannot set headers (EventSource browsers), but Bearer header is preferred.
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// In-process event bus
// Exported so orchestrate / other routes can publish events.
// ---------------------------------------------------------------------------

type OrchestratorEvent = {
  type: string;
  data: Record<string, unknown>;
  ts: string;
};

type EventWriter = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => void;
};

/** All currently connected SSE clients */
const clients = new Set<EventWriter>();

/**
 * Publish an event to all connected Open-Chat clients.
 * Safe to call from any route handler or background task.
 */
export function publishEvent(event: OrchestratorEvent): void {
  if (clients.size === 0) return;

  const encoder = new TextEncoder();
  const line = `data: ${JSON.stringify(event)}\n\n`;
  const chunk = encoder.encode(line);

  for (const client of clients) {
    client.write(chunk).catch(() => {
      // Client disconnected — remove it
      clients.delete(client);
      client.close();
    });
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(request: NextRequest) {
  // Support ?token=... for EventSource clients that can't set headers
  const urlToken = new URL(request.url).searchParams.get('token');
  let authorised: boolean;

  if (urlToken) {
    // Re-use the authorizeRequest helper by building a synthetic header
    const syntheticRequest = new Request(request.url, {
      headers: { Authorization: `Bearer ${urlToken}` },
    });
    authorised = !authorizeRequest(syntheticRequest as NextRequest);
  } else {
    authorised = !authorizeRequest(request);
  }

  if (!authorised) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const eventWriter: EventWriter = {
    write: (chunk) => writer.write(chunk),
    close: () => { writer.close().catch(() => undefined); },
  };

  clients.add(eventWriter);

  // Send initial connected event
  const connectedEvent: OrchestratorEvent = {
    type: 'connected',
    data: { message: 'Open-Chat event stream connected', client_count: clients.size },
    ts: new Date().toISOString(),
  };
  await writer.write(encoder.encode(`data: ${JSON.stringify(connectedEvent)}\n\n`));

  // Heartbeat to keep proxies from closing the idle connection
  const heartbeat = setInterval(async () => {
    try {
      await writer.write(encoder.encode(': heartbeat\n\n'));
    } catch {
      clearInterval(heartbeat);
      clients.delete(eventWriter);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up when the client disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    clients.delete(eventWriter);
    writer.close().catch(() => undefined);
  }, { once: true });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
