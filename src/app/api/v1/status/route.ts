/**
 * /api/v1/status — Open Chat client status exchange
 * GET  — Get Draymond system status
 * POST — Report Open Chat client status
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';
import { emitClientConnected, emitClientDisconnected } from '@/lib/draymond/event-bridge';

export const dynamic = 'force-dynamic';

// In-memory client status tracking
type ClientStatus = {
  client_id: string;
  last_seen: string;
  version?: string;
  platform?: string;
};

const connectedClients = new Map<string, ClientStatus>();

// Clean up stale clients every 5 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function cleanStaleClients(): void {
  const now = Date.now();
  for (const [id, client] of connectedClients) {
    if (now - new Date(client.last_seen).getTime() > STALE_THRESHOLD_MS) {
      connectedClients.delete(id);
    }
  }
}

// GET — Return Draymond system status + connected clients count
export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  cleanStaleClients();

  return NextResponse.json({
    ok: true,
    status: 'online',
    server_time: new Date().toISOString(),
    connected_clients: connectedClients.size,
    clients: Array.from(connectedClients.values()),
    uptime_ms: process.uptime() * 1000,
  });
}

// POST — Report client status (heartbeat/connect/disconnect)
export async function POST(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { data: body, error: parseError } = await parseJsonBody<{
    client_id?: string;
    action?: 'connect' | 'disconnect' | 'heartbeat';
    version?: string;
    platform?: string;
  }>(request);
  if (parseError) return parseError;

  if (!body.client_id || typeof body.client_id !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Missing required field: client_id' },
      { status: 400 },
    );
  }

  const action = body.action ?? 'heartbeat';

  if (!['connect', 'disconnect', 'heartbeat'].includes(action)) {
    return NextResponse.json(
      { ok: false, error: 'action must be "connect", "disconnect", or "heartbeat"' },
      { status: 400 },
    );
  }

  cleanStaleClients();

  if (action === 'disconnect') {
    connectedClients.delete(body.client_id);
    emitClientDisconnected(body.client_id, connectedClients.size);
    return NextResponse.json({ ok: true, action: 'disconnected', connected_clients: connectedClients.size });
  }

  // connect or heartbeat — update/add client entry
  const wasNew = !connectedClients.has(body.client_id);
  connectedClients.set(body.client_id, {
    client_id: body.client_id,
    last_seen: new Date().toISOString(),
    version: body.version,
    platform: body.platform,
  });

  if (wasNew || action === 'connect') {
    emitClientConnected(body.client_id, connectedClients.size);
  }

  return NextResponse.json({
    ok: true,
    action: wasNew ? 'connected' : 'heartbeat',
    connected_clients: connectedClients.size,
  });
}
