import { describe, expect, it, beforeAll } from 'vitest';

// Force the local DB to in-memory so the seed writes land in a scratch DB.
process.env.DRAYMOND_DB_PATH = ':memory:';

import { seedBusinessAutomation } from '../src/lib/draymond/business-chains';
import { seedSkillPacks } from '../src/lib/draymond/skill-packs';
import { registerEntities } from '../src/lib/draymond/registry';
import { SEED_ENTITIES } from '../src/lib/draymond/seed';
import { seedChainTemplates } from '../src/lib/draymond/chains-seed';
import { buildOpsCatalog } from '../src/lib/draymond/ops-catalog';
import { searchEntities } from '../src/lib/draymond/registry';

describe('book-to-skill pipeline (e2e)', () => {
  beforeAll(async () => {
    // Entities must be registered before chain templates (which resolve by slug).
    const entityResult = await registerEntities(SEED_ENTITIES);
    expect(entityResult.errors).toEqual([]);

    const [biz, skillPacks, chainResult] = await Promise.all([
      seedBusinessAutomation(),
      seedSkillPacks(),
      seedChainTemplates(),
    ]);
    expect(biz.errors).toEqual([]);
    expect(skillPacks.errors).toEqual([]);
    expect(chainResult.errors).toEqual([]);
  });

  it('registers the book entities so the chain-builder can resolve them', async () => {
    const entities = await searchEntities({ is_active: true, limit: 500 });
    const slugs = new Set(entities.map((e) => e.slug));
    for (const s of ['bookbridge', 'book-bridge', 'book-to-skill', 'book-synthesis-personal', 'book-to-skill-chain', 'github-pull']) {
      expect(slugs.has(s), `expected entity ${s}`).toBe(true);
    }
  });

  it('seeds the tpl-book-to-skill-chain template', async () => {
    // Re-run idempotently and confirm no errors.
    const result = await seedChainTemplates();
    const tpl = result.seeded.find((c) => c.slug === 'tpl-book-to-skill-chain');
    expect(tpl).toBeDefined();
    expect(result.errors).toEqual([]);
  });

  it('surfaces book + github resources in the ops catalog', async () => {
    const catalog = await buildOpsCatalog();
    const skillSlugs = catalog.skills.map((s) => s.slug);
    for (const s of ['book-bridge', 'book-to-skill', 'book-synthesis-personal', 'book-to-skill-chain', 'github-pull']) {
      expect(skillSlugs, `catalog skill ${s}`).toContain(s);
    }
    const serviceSlugs = catalog.services.map((s) => s.slug);
    expect(serviceSlugs).toContain('bookbridge');
    // The scheduled job appears in the catalog jobs.
    expect(catalog.jobs.some((j) => j.name === 'Book-Grounded Research')).toBe(true);
  });

  it('seeds the github_pull + book skill packs for worker dispatch', async () => {
    const result = await seedSkillPacks();
    expect(result.seeded).toBe(13);
    for (const n of ['github_pull', 'book_grounded_research', 'book_to_skill_distill', 'book_synthesis_personal', 'on_device_ops']) {
      expect(result.names).toContain(n);
    }
    expect(result.errors).toEqual([]);
  });
});
