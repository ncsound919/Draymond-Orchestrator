import { getAgentBySlug } from '@/lib/registry/agent-store';
import { getEntity } from '@/lib/draymond/registry';
import AgentBioPage from '@/components/registry/AgentBioPage';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let agent: Awaited<ReturnType<typeof getAgentBySlug>>;
  try {
    agent = await getAgentBySlug(slug);
  } catch (err) {
    console.error('[AgentPage] Failed to load agent:', err);
    notFound();
  }
  if (!agent) notFound();

  // Try to find a matching Supabase entity for enhanced controls
  let entity: { id: string; health_status: string; capabilities: string[]; is_active: boolean } | null = null;
  try {
    const e = await getEntity(slug);
    if (e) {
      entity = {
        id: e.id,
        health_status: e.health_status,
        capabilities: e.capabilities,
        is_active: e.is_active,
      };
    }
  } catch {
    // Entity not found in Supabase — that's fine
  }

  return <AgentBioPage agent={agent} entity={entity} />;
}
