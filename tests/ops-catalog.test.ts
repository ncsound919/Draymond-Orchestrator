import { describe, it, expect, beforeEach } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { buildOpsCatalog, renderCatalogMarkdown } from '@/lib/draymond/ops-catalog';

describe('ops-catalog', () => {
  beforeEach(() => {
    // getDb caches a handle; for an in-memory DB each test process is fresh.
    process.env.DRAYMOND_DB_PATH = ':memory:';
  });

  it('builds a catalog with totals and grouped views', async () => {
    const catalog = await buildOpsCatalog();
    expect(catalog.all.length).toBeGreaterThan(0);
    expect(catalog.totals.skill).toBeGreaterThan(0);
    expect(catalog.totals.agent).toBeGreaterThan(0);
    expect(Array.isArray(catalog.skills)).toBe(true);
    expect(Array.isArray(catalog.agents)).toBe(true);
    expect(catalog.byCategory).toBeDefined();
    expect(catalog.byKind).toBeDefined();
  });

  it('marks every catalog item with a source', async () => {
    const catalog = await buildOpsCatalog();
    for (const item of catalog.all) {
      expect(item.source).toBeTruthy();
    }
  });

  it('renders a markdown catalog with totals and a category section', async () => {
    const catalog = await buildOpsCatalog();
    const md = renderCatalogMarkdown(catalog);
    expect(md).toContain('# Uplift Lab — Operational Catalog');
    expect(md).toContain('## Totals');
    expect(md).toContain('## By Category');
    expect(md).toContain(`**${catalog.all.length}**`);
  });
});
