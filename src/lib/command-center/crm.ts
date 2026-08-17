// ============================================================================
// Command Center — CRM data access (command_leads)
// ============================================================================
// CRUD + stage transitions against the local SQLite store via the
// supabase-compatible LocalQueryBuilder. Server-side only.
// ============================================================================

import { createDraymondAdminClient } from '@/lib/draymond/client';
import type { CommandLead, LeadInsert, LeadStage } from './types';

const STAGES: LeadStage[] = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

function isStage(v: unknown): v is LeadStage {
  return typeof v === 'string' && (STAGES as string[]).includes(v);
}

export async function listLeads(): Promise<CommandLead[]> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_leads')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommandLead[];
}

export async function listLeadsByStage(stage: LeadStage): Promise<CommandLead[]> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_leads')
    .select('*')
    .eq('stage', stage)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommandLead[];
}

export async function getLead(id: string): Promise<CommandLead | null> {
  const client = createDraymondAdminClient();
  const { data, error } = await client.from('command_leads').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CommandLead) ?? null;
}

export async function createLead(input: LeadInsert): Promise<CommandLead> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_leads')
    .insert({ ...input, name: input.name, stage: input.stage ?? 'new', tags: input.tags ?? [] })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CommandLead;
}

export async function updateLead(
  id: string,
  patch: Partial<Omit<CommandLead, 'id' | 'created_at' | 'updated_at'>>,
): Promise<CommandLead> {
  const client = createDraymondAdminClient();
  const { data, error } = await client
    .from('command_leads')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as CommandLead;
}

/** Move a lead between kanban stages. Validates the stage is one of the 6. */
export async function moveLead(id: string, stage: unknown): Promise<CommandLead> {
  if (!isStage(stage)) throw new Error(`Invalid stage: ${String(stage)}`);
  return updateLead(id, { stage });
}

/** Append a note to a lead's notes array. */
export async function addLeadNote(id: string, text: string, by?: string): Promise<CommandLead> {
  const lead = await getLead(id);
  if (!lead) throw new Error('Lead not found');
  const notes = [...(lead.notes ?? []), { text, by, at: new Date().toISOString() }];
  return updateLead(id, { notes });
}

export async function deleteLead(id: string): Promise<void> {
  const client = createDraymondAdminClient();
  const { error } = await client.from('command_leads').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function leadStageCounts(): Promise<Record<LeadStage, number>> {
  const leads = await listLeads();
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
  for (const lead of leads) {
    if (isStage(lead.stage)) counts[lead.stage] += 1;
  }
  return counts;
}
