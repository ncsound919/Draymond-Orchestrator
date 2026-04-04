/**
 * GET  /api/registry/agents        — list all registered agents
 * POST /api/registry/agents        — register/upsert an agent
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, upsertAgent } from '@/lib/registry/agent-store';
import { RegisteredAgent } from '@/lib/registry/types';

export async function GET() {
  try {
    const agents = await getAllAgents();
    return NextResponse.json({ agents, total: agents.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read registry' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<RegisteredAgent>;
    if (!body.id || !body.name || !body.slug) {
      return NextResponse.json(
        { error: 'id, name, and slug are required' },
        { status: 400 },
      );
    }
    const now = new Date().toISOString();
    const agent: RegisteredAgent = {
      tier: 'custom',
      role: 'Assistant',
      bio: '',
      personality: 'analytical',
      theme: { accentColor: '#6366f1', cardStyle: 'glass', portraitFrame: 'hexagon', badgeColor: '#6366f1' },
      specialties: [],
      capabilities: [],
      stats: [],
      tags: [],
      runtime: { type: 'http', healthPath: '/health', timeoutMs: 30000 },
      permissions: { canReadFiles: false, canWriteFiles: false, canRunCommands: false, canAccessInternet: true, canAccessDatabase: false, canSendEmail: false },
      workflows: [],
      memoryEnabled: true,
      status: 'unknown',
      installedAt: now,
      updatedAt: now,
      version: '1.0.0',
      sourceType: 'registry',
      ...body,
    } as RegisteredAgent;
    await upsertAgent(agent);
    return NextResponse.json({ ok: true, agent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to register agent' },
      { status: 500 },
    );
  }
}
