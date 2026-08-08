import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '@/lib/db/connection';
import { upsertSkillPack, listSkillPacks, getSkillPack, proposeSkillPack, listProposals, reviewProposal } from '@/lib/draymond/skill-packs';

describe('skill-packs', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM draymond_skill_packs").run();
    db.prepare("DELETE FROM draymond_worker_proposals").run();
  });

  it('upserts a versioned pack and lists it', async () => {
    await upsertSkillPack({
      name: 'social_post',
      version: '1.0.0',
      purpose: 'Post approved copy via phone apps',
      triggers: ['post to x', 'publish instagram'],
      instructions: 'Open the target app, type the draft, tap publish.',
      tools: ['phone_control', 'capture', 'email'],
      platforms: ['x', 'linkedin', 'instagram'],
      outputs: ['post'],
    });
    const all = await listSkillPacks();
    expect(all.some((p) => p.name === 'social_post' && p.version === '1.0.0')).toBe(true);
  });

  it('fetches a single pack by name+version', async () => {
    await upsertSkillPack({ name: 'lead_pulse', version: '2.0.0', tools: ['web'], outputs: ['email'] });
    const pack = await getSkillPack('lead_pulse', '2.0.0');
    expect(pack?.name).toBe('lead_pulse');
  });

  it('proposes and reviews a worker skill', async () => {
    await proposeSkillPack('worker-1', { name: 'phone_dialer', version: '0.1.0' });
    const props = await listProposals();
    expect(props.length).toBe(1);
    await reviewProposal(props[0].id, 'approved');
    const after = await listProposals();
    expect(after[0].status).toBe('approved');
  });
});
