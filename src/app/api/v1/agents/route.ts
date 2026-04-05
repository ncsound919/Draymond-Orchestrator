/**
 * GET /api/v1/agents
 * Open-Chat companion agent discovery endpoint.
 * Proxies the internal registry so Open-Chat's DraymondOrchestratorClient
 * can call GET /v1/agents (mapped here as /api/v1/agents) and get a
 * normalised list of registered agents with their capabilities.
 *
 * Auth: Bearer token checked against CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/registry/agent-store';
import { authorizeRequest, sanitizeError } from '@/lib/draymond/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  try {
    const registeredAgents = await getAllAgents();

    // Normalise to the shape Open-Chat expects:
    // { id, name, capabilities[], status, last_heartbeat }
    const agents = registeredAgents.map((a) => ({
      id: a.id,
      name: a.name,
      capabilities: a.capabilities ?? [],
      status: a.status ?? 'unknown',
      last_heartbeat: a.updatedAt ?? null,
    }));

    return NextResponse.json({ agents, total: agents.length });
  } catch (err) {
    console.error('[api/v1/agents] GET error:', err);
    return NextResponse.json(
      { error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
