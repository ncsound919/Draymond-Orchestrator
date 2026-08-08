// ============================================================================
// Skill Pack Catalog — the boss's playbook. Draymond owns versioned skill
// packs; Open Chat caches and executes them. Proposals from Open Chat land in
// a review queue here.
// ============================================================================

import { randomUUID } from 'crypto';
import { createDraymondAdminClient } from './client';

export interface SkillPack {
  id: string;
  name: string;
  version: string;
  purpose: string;
  triggers: string[];
  instructions: string;
  tools: string[];
  platforms: string[];
  outputs: string[];
  review_status: 'draft' | 'approved' | 'rejected';
  source: 'draymond' | 'openchat';
  created_at: string;
  updated_at: string;
}

export interface SkillPackInput {
  name: string;
  version?: string;
  purpose?: string;
  triggers?: string[];
  instructions?: string;
  tools?: string[];
  platforms?: string[];
  outputs?: string[];
  review_status?: SkillPack['review_status'];
  source?: SkillPack['source'];
}

export interface Proposal {
  id: string;
  worker_id: string;
  pack: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export async function upsertSkillPack(input: SkillPackInput): Promise<SkillPack> {
  const db = createDraymondAdminClient();
  const version = input.version ?? '1.0.0';
  const { data: existing } = await db
    .from('draymond_skill_packs')
    .select('id')
    .eq('name', input.name)
    .eq('version', version)
    .maybeSingle();
  const now = new Date().toISOString();
  const row = {
    id: (existing as { id: string } | null)?.id ?? randomUUID(),
    name: input.name,
    version,
    purpose: input.purpose ?? '',
    triggers: input.triggers ?? [],
    instructions: input.instructions ?? '',
    tools: input.tools ?? [],
    platforms: input.platforms ?? [],
    outputs: input.outputs ?? [],
    review_status: input.review_status ?? 'approved',
    source: input.source ?? 'draymond',
    created_at: existing ? undefined : now,
    updated_at: now,
  };
  const { error } = await db
    .from('draymond_skill_packs')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to upsert skill pack: ${error.message}`);
  }
  const pack = await getSkillPack(input.name, version);
  if (!pack) throw new Error('Failed to upsert skill pack');
  return pack;
}

export async function listSkillPacks(status?: SkillPack['review_status']): Promise<SkillPack[]> {
  const db = createDraymondAdminClient();
  let query = db.from('draymond_skill_packs').select('*').order('name');
  if (status) query = query.eq('review_status', status);
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list skill packs: ${error.message}`);
  }
  return (data ?? []) as SkillPack[];
}

export async function getSkillPack(name: string, version: string): Promise<SkillPack | null> {
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_skill_packs')
    .select('*')
    .eq('name', name)
    .eq('version', version)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get skill pack: ${error.message}`);
  }
  return (data as SkillPack | null) ?? null;
}

export async function proposeSkillPack(workerId: string, pack: Record<string, unknown>): Promise<void> {
  const db = createDraymondAdminClient();
  const { error } = await db
    .from('draymond_worker_proposals')
    .insert({ worker_id: workerId, pack, status: 'pending' });
  if (error) {
    throw new Error(`Failed to propose skill pack: ${error.message}`);
  }
}

export async function listProposals(): Promise<Proposal[]> {
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_worker_proposals')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list proposals: ${error.message}`);
  }
  return (data ?? []) as Proposal[];
}

export async function reviewProposal(id: string, status: 'approved' | 'rejected'): Promise<void> {
  const db = createDraymondAdminClient();
  const { error } = await db
    .from('draymond_worker_proposals')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    throw new Error(`Failed to review proposal: ${error.message}`);
  }
}
