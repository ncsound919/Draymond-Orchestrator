/**
 * GET    /api/registry/agents/[slug]  — get single agent
 * PATCH  /api/registry/agents/[slug]  — partial update
 * DELETE /api/registry/agents/[slug]  — remove agent
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAgentBySlug, upsertAgent, deleteAgent, getAllAgents } from '@/lib/registry/agent-store';
import { authorizeRequest, parseJsonBody } from '@/lib/draymond/api-auth';

const PATCHABLE_FIELDS = new Set([
  'name', 'role', 'bio', 'backstory', 'personality', 'codename',
  'tier', 'specialties', 'capabilities', 'stats', 'tags', 'theme',
  'runtime', 'permissions', 'workflows', 'memoryEnabled', 'status',
  'version', 'avatarUrl', 'coverUrl', 'modelPreferences', 'systemPrompt',
]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const authError = authorizeRequest(request);
  if (authError) return authError;

  const { slug } = await params;
  const agent = await getAgentBySlug(slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const bodyResult = await parseJsonBody<Record<string, unknown>>(request);
  if (bodyResult.error) return bodyResult.error;
  const updates = bodyResult.data;
  // Only allow known fields to be updated
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (PATCHABLE_FIELDS.has(key)) filtered[key] = value;
  }
  await upsertAgent({ ...agent, ...filtered, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const authError = authorizeRequest(req);
  if (authError) return authError;

  const { slug } = await params;
  const agents = await getAllAgents();
  const agent = agents.find((a) => a.slug === slug);
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  await deleteAgent(agent.id);
  return NextResponse.json({ ok: true });
}
