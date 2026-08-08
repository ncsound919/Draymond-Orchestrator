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

  it('upserts an existing pack in place (version kept, fields updated)', async () => {
    await upsertSkillPack({ name: 'lead_pulse', version: '1.0.0', instructions: 'old instructions' });
    await upsertSkillPack({ name: 'lead_pulse', version: '1.0.0', instructions: 'new instructions', tools: ['web', 'email'] });
    const all = await listSkillPacks();
    expect(all).toHaveLength(1);
    expect(all[0].instructions).toBe('new instructions');
    expect(all[0].version).toBe('1.0.0');
    const pack = await getSkillPack('lead_pulse', '1.0.0');
    expect(pack?.tools).toEqual(['web', 'email']);
  });

  it('lists only packs matching the review status filter', async () => {
    await upsertSkillPack({ name: 'approved_pack', version: '1.0.0' });
    await upsertSkillPack({ name: 'draft_pack', version: '1.0.0', review_status: 'draft' });
    const approved = await listSkillPacks('approved');
    expect(approved.map((p) => p.name)).toEqual(['approved_pack']);
    const drafts = await listSkillPacks('draft');
    expect(drafts.map((p) => p.name)).toEqual(['draft_pack']);
  });

  it('orders packs by name then newest version first', async () => {
    await upsertSkillPack({ name: 'beta', version: '1.0.0' });
    await upsertSkillPack({ name: 'alpha', version: '2.0.0' });
    await upsertSkillPack({ name: 'alpha', version: '1.0.0' });
    const all = await listSkillPacks();
    expect(all.map((p) => `${p.name}@${p.version}`)).toEqual(['alpha@2.0.0', 'alpha@1.0.0', 'beta@1.0.0']);
  });

  it('returns null for a missing pack', async () => {
    const pack = await getSkillPack('does_not_exist', '9.9.9');
    expect(pack).toBeNull();
  });

  it('round-trips JSON columns as arrays', async () => {
    await upsertSkillPack({
      name: 'json_roundtrip',
      version: '1.0.0',
      triggers: ['trigger a', 'trigger b'],
      tools: ['tool_1'],
      platforms: ['x'],
      outputs: ['post'],
    });
    const pack = await getSkillPack('json_roundtrip', '1.0.0');
    expect(Array.isArray(pack?.triggers)).toBe(true);
    expect(pack?.triggers).toEqual(['trigger a', 'trigger b']);
    expect(Array.isArray(pack?.tools)).toBe(true);
    expect(pack?.tools).toEqual(['tool_1']);
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
    expect(after[0].reviewed_at).toBeTruthy();
    expect(after[0].pack).toEqual({ name: 'phone_dialer', version: '0.1.0' });
  });

  it('returns false when reviewing a nonexistent proposal', async () => {
    const changed = await reviewProposal('no-such-proposal', 'approved');
    expect(changed).toBe(false);
  });

  it('seeds the five first skill packs', async () => {
    const { seedSkillPacks } = await import('@/lib/draymond/skill-packs');
    await seedSkillPacks();
    const all = await listSkillPacks();
    const names = new Set(all.map((p) => p.name));
    for (const n of ['marketing_draft', 'social_post', 'email_report', 'lead_pulse', 'vibe_ui_gen']) {
      expect(names.has(n)).toBe(true);
    }
  });
});
