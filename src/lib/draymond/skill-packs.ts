// ============================================================================
// Skill Pack Catalog — the boss's playbook. Draymond owns versioned skill
// packs; Open Chat caches and executes them. Proposals from Open Chat land in
// a review queue here.
// ============================================================================

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
  reviewed_at: string | null;
}

export async function upsertSkillPack(input: SkillPackInput): Promise<SkillPack> {
  const db = createDraymondAdminClient();
  const version = input.version ?? '1.0.0';
  // Atomic create-or-update keyed on the UNIQUE (name, version) constraint —
  // no read-then-write, so concurrent upserts for the same pack can't race.
  const { data, error } = await db
    .from('draymond_skill_packs')
    .upsert(
      {
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
      },
      { onConflict: 'name,version' }
    )
    .select()
    .single();
  if (error) {
    throw new Error(`Failed to upsert skill pack: ${error.message}`);
  }
  return data as SkillPack;
}

export interface SeedSkillPacksResult {
  seeded: number;
  errors: string[];
  names: string[];
}

/**
 * Seed the first skill packs into the catalog. Idempotent — each pack is
 * upserted on the UNIQUE (name, version) constraint, so repeated seed runs
 * update in place instead of duplicating. Invoked from POST /api/seed.
 *
 * Each pack is isolated: a failure on one pack is recorded in `errors` and
 * seeding continues with the next pack, mirroring the sibling seed routines
 * (seedBusinessAutomation / seedAgentMonitors).
 */
export async function seedSkillPacks(): Promise<SeedSkillPacksResult> {
  const packs: SkillPackInput[] = [
    {
      name: 'marketing_draft',
      version: '1.0.0',
      purpose: 'Research trends and draft marketing copy per platform.',
      triggers: ['draft post', 'content draft', 'marketing copy'],
      instructions:
        'Open an AI research app (Perplexity/Gemini), prompt for trending angles on the topic, ' +
        'then draft platform-appropriate copy + hashtags. Report the draft back for review.',
      tools: ['ai_apps', 'email', 'outputs'],
      platforms: ['x', 'linkedin', 'instagram'],
      outputs: ['draft', 'email'],
    },
    {
      name: 'social_post',
      version: '1.0.0',
      purpose: 'Post approved copy via phone apps.',
      triggers: ['post to', 'publish', 'post on x', 'post on instagram'],
      instructions:
        'Open the target phone app via PhoneControl, type the approved draft, tap publish, ' +
        'screenshot the resulting post, attach it to the report email.',
      tools: ['phone_control', 'capture', 'email'],
      platforms: ['x', 'linkedin', 'instagram'],
      outputs: ['post', 'screenshot', 'email'],
    },
    {
      name: 'email_report',
      version: '1.0.0',
      purpose: 'Compose and send a task report with attachments back to Draymond.',
      triggers: ['send report', 'email the results', 'report back'],
      instructions:
        'Compose a concise summary of the completed task, attach any files/images, ' +
        'and send to tap4500@gmail.com with subject [OpenChat: <task_id>].',
      tools: ['email', 'capture'],
      platforms: [],
      outputs: ['email'],
    },
    {
      name: 'lead_pulse',
      version: '1.0.0',
      purpose: 'Query Aetherdesk CRM for new leads and summarize.',
      triggers: ['new leads', 'lead pulse', 'check crm'],
      instructions:
        'Call the Aetherdesk CRM tool to list new leads, summarize the count and ' +
        'top entries into the briefing.',
      tools: ['web'],
      platforms: [],
      outputs: ['summary'],
    },
    {
      name: 'vibe_ui_gen',
      version: '1.0.0',
      purpose: 'Request a UI build from VibeServe and email the generated code.',
      triggers: ['build ui', 'generate ui', 'vibeserve'],
      instructions:
        'Call the VibeServe MCP tool with the UI request, collect the generated code, ' +
        'and email the artifact to Draymond.',
      tools: ['vibe_serve', 'email'],
      platforms: [],
      outputs: ['code', 'email'],
    },
  ];
  const result: SeedSkillPacksResult = {
    seeded: 0,
    errors: [],
    names: [],
  };
  for (const p of packs) {
    try {
      await upsertSkillPack(p);
      result.seeded += 1;
      result.names.push(p.name);
    } catch (err) {
      result.errors.push(
        `[skill-pack:${p.name}] ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return result;
}

export async function listSkillPacks(status?: SkillPack['review_status']): Promise<SkillPack[]> {
  const db = createDraymondAdminClient();
  let query = db
    .from('draymond_skill_packs')
    .select('*')
    .order('name')
    .order('version', { ascending: false });
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

export async function reviewProposal(id: string, status: 'approved' | 'rejected'): Promise<boolean> {
  const db = createDraymondAdminClient();
  const { data, error } = await db
    .from('draymond_worker_proposals')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) {
    throw new Error(`Failed to review proposal: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}
