/**
 * GET /api/v1/events
 * Open-Chat companion real-time SSE event stream.
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

/** Maximum concurrent SSE connections to prevent resource exhaustion. */
const MAX_CLIENTS = 50;

/** All currently connected SSE clients */
const clients = new Set<EventWriter>();

/** Module-level encoder — reused across all publishEvent calls. */
const sharedEncoder = new TextEncoder();

/**
 * Publish an event to all connected Open-Chat clients.
 * Safe to call from any route handler or background task.
 */
export function publishEvent(event: OrchestratorEvent): void {
  if (clients.size === 0) return;

  const line = `data: ${JSON.stringify(event)}\n\n`;
  const chunk = sharedEncoder.encode(line);

  // Collect dead clients instead of mutating the Set during iteration
  const dead: EventWriter[] = [];

  for (const client of clients) {
    client.write(chunk).catch(() => {
      dead.push(client);
    });
  }

  // Clean up disconnected clients after the iteration completes
  for (const client of dead) {
    clients.delete(client);
    client.close();
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(request: NextRequest) {
  // Enforce connection limit
  if (clients.size >= MAX_CLIENTS) {
    return new Response(JSON.stringify({ error: 'Too many connections' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Authenticate via Authorization header only — never accept the admin
  // secret in a query string (it would leak into logs/history/referers).
  const authorised = !authorizeRequest(request);

  if (!authorised) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
  await writer.write(sharedEncoder.encode(`data: ${JSON.stringify(connectedEvent)}\n\n`));

  // Heartbeat to keep proxies from closing the idle connection
  const heartbeat = setInterval(async () => {
    try {
      await writer.write(sharedEncoder.encode(': heartbeat\n\n'));
    } catch {
      clearInterval(heartbeat);
      clients.delete(eventWriter);
      eventWriter.close();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up when the client disconnects
  request.signal.addEventListener('abort', () => {
    clearInterval(heartbeat);
    clients.delete(eventWriter);
    eventWriter.close();
  }, { once: true });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
