/**
 * GET    /api/registry/agents/[slug]  — get single agent
 * PATCH  /api/registry/agents/[slug]  — partial update
 * DELETE /api/registry/agents/[slug]  — remove agent
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAgentBySlug, upsertAgent, deleteAgent, getAllAgents } from '@/lib/registry/agent-store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const updates = await request.json();
  await upsertAgent({ ...agent, ...updates, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agents = await getAllAgents();
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  await deleteAgent(agent.id);
  return NextResponse.json({ ok: true });
}
