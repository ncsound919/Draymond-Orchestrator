// ============================================================================
// DRAYMOND OPS CATALOG — unified operational inventory of all moving parts.
// ============================================================================
// Source of truth: the local SQLite entity registry (draymond_entities) plus
// the file registry (registry.json agents/workflows/skills) plus chain/job
// tables. This module folds them into one categorized catalog the operations
// dashboard and /api/ops/catalog can serve, and the ops generator script can
// render to OPS-CATALOG.md.
//
// Deterministic + read-only: never mutates state. Every field is derived.
// ============================================================================

import { searchEntities } from './registry';
import { getSeedJobDefs } from './business-chains';
import { getAllAgents, getAllSkills, getAllWorkflows } from '@/lib/registry/agent-store';
import { listChains } from './chains';

export interface CatalogItem {
  slug: string;
  name: string;
  kind: 'agent' | 'skill' | 'tool' | 'service' | 'extension' | 'mcp_server' | 'workflow' | 'chain' | 'job';
  category: string;
  sector: string | null;
  description: string;
  capabilities: string[];
  invocation: string;
  active: boolean;
  source: 'entity-db' | 'registry-file' | 'chain-table' | 'job-table';
}

export interface OpsCatalog {
  generatedAt: string;
  totals: Record<string, number>;
  byCategory: Record<string, CatalogItem[]>;
  byKind: Record<string, CatalogItem[]>;
  agents: CatalogItem[];
  skills: CatalogItem[];
  tools: CatalogItem[];
  services: CatalogItem[];
  chains: CatalogItem[];
  jobs: CatalogItem[];
  all: CatalogItem[];
}

function toItem(
  slug: string,
  name: string,
  kind: CatalogItem['kind'],
  category: string,
  sector: string | null,
  description: string,
  capabilities: string[],
  invocation: string,
  active: boolean,
  source: CatalogItem['source']
): CatalogItem {
  return { slug, name, kind, category: category || 'uncategorized', sector, description, capabilities, invocation, active, source };
}

/** Map a draymond_entities kind to the catalog kind union. */
function entityKindToCatalogKind(kind: string): CatalogItem['kind'] {
  switch (kind) {
    case 'agent': return 'agent';
    case 'skill': return 'skill';
    case 'tool': return 'tool';
    case 'service': return 'service';
    case 'extension': return 'extension';
    case 'mcp_server': return 'mcp_server';
    default: return 'tool';
  }
}

/** Pull all active entities from the SQLite registry. */
async function entityItems(): Promise<CatalogItem[]> {
  const entities = await searchEntities({ is_active: true, limit: 500 });
  return entities.map((e) =>
    toItem(
      e.slug,
      e.name,
      entityKindToCatalogKind(e.kind),
      e.category ?? 'uncategorized',
      e.sector ?? null,
      e.description ?? '',
      e.capabilities ?? [],
      `${e.invocation_method ?? 'manual'}`,
      e.is_active !== false,
      'entity-db'
    )
  );
}

/** Pull agents/skills/workflows from the file registry (registry.json). */
async function fileItems(): Promise<CatalogItem[]> {
  const [agents, skills, workflows] = await Promise.all([getAllAgents(), getAllSkills(), getAllWorkflows()]);
  const items: CatalogItem[] = [];
  for (const a of agents) {
    items.push(
      toItem(
        a.slug,
        a.name,
        'agent',
        'uncategorized',
        null,
        a.bio ?? '',
        a.specialties ?? [],
        a.runtime?.type ?? 'registry',
        true,
        'registry-file'
      )
    );
  }
  for (const s of skills) {
    items.push(toItem(s.slug, s.name, 'skill', s.category ?? 'uncategorized', null, s.description ?? '', [], `path:${s.path}`, true, 'registry-file'));
  }
  for (const w of workflows) {
    items.push(toItem(w.id ?? w.name, w.name, 'workflow', 'workflow', null, w.description ?? '', [], `steps:${w.steps?.length ?? 0}`, true, 'registry-file'));
  }
  return items;
}

/** Pull chain templates from the chain table. */
async function chainItems(): Promise<CatalogItem[]> {
  try {
    const chains = await listChains({ is_template: true, limit: 200 });
    return chains.map((c) =>
      toItem(c.slug, c.name, 'chain', 'workflow', null, c.description ?? '', [], `steps:${c.total_steps ?? 0}`, c.is_template !== false, 'chain-table')
    );
  } catch {
    return [];
  }
}

/** Pull scheduled job definitions (from the seeded job defs, since the DB job table mirrors them). */
async function jobItems(): Promise<CatalogItem[]> {
  try {
    const defs = getSeedJobDefs();
    return defs.map((d) =>
      toItem(d.name, d.name, 'job', 'schedule', null, d.job_type, [], d.cron_expression, true, 'job-table')
    );
  } catch {
    return [];
  }
}

function categorize(items: CatalogItem[]): {
  byCategory: Record<string, CatalogItem[]>;
  byKind: Record<string, CatalogItem[]>;
} {
  const byCategory: Record<string, CatalogItem[]> = {};
  const byKind: Record<string, CatalogItem[]> = {};
  for (const it of items) {
    if (!byCategory[it.category]) byCategory[it.category] = [];
    byCategory[it.category].push(it);
    if (!byKind[it.kind]) byKind[it.kind] = [];
    byKind[it.kind].push(it);
  }
  for (const k of Object.keys(byCategory)) byCategory[k].sort((a, b) => a.name.localeCompare(b.name));
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.name.localeCompare(b.name));
  return { byCategory, byKind };
}

/**
 * Build the full operational catalog. Merges entity-DB, file-registry, chain,
 * and job sources, de-duplicating by (kind, slug) with entity-DB winning.
 */
export async function buildOpsCatalog(): Promise<OpsCatalog> {
  const [entityItems_, fileItems_, chainItems_, jobItems_] = await Promise.all([
    entityItems(),
    fileItems(),
    chainItems(),
    jobItems(),
  ]);

  const merged = new Map<string, CatalogItem>();
  const add = (it: CatalogItem) => {
    const key = `${it.kind}|${it.slug}`;
    if (!merged.has(key)) merged.set(key, it);
  };
  // Precedence: entity-DB over file-registry; chains/jobs always added.
  for (const it of chainItems_) add(it);
  for (const it of jobItems_) add(it);
  for (const it of fileItems_) add(it);
  for (const it of entityItems_) add(it);

  const all = [...merged.values()];
  const { byCategory, byKind } = categorize(all);

  const totals: Record<string, number> = {};
  for (const it of all) totals[it.kind] = (totals[it.kind] ?? 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    totals,
    byCategory,
    byKind,
    agents: byKind.agent ?? [],
    skills: byKind.skill ?? [],
    tools: byKind.tool ?? [],
    services: byKind.service ?? [],
    chains: byKind.chain ?? [],
    jobs: byKind.job ?? [],
    all,
  };
}

/** Render the catalog as a markdown document for OPS-CATALOG.md. */
export function renderCatalogMarkdown(catalog: OpsCatalog): string {
  const lines: string[] = [];
  lines.push('# Uplift Lab — Operational Catalog');
  lines.push('');
  lines.push(`Generated: ${catalog.generatedAt}`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  const totalCount = catalog.all.length;
  const kinds = Object.entries(catalog.totals).sort((a, b) => b[1] - a[1]);
  lines.push(`| Kind | Count |`);
  lines.push(`| --- | --- |`);
  for (const [k, n] of kinds) lines.push(`| ${k} | ${n} |`);
  lines.push(`| **Total** | **${totalCount}** |`);
  lines.push('');

  lines.push('## By Category');
  lines.push('');
  const cats = Object.entries(catalog.byCategory).sort((a, b) => b[1].length - a[1].length);
  for (const [cat, items] of cats) {
    lines.push(`### ${cat} (${items.length})`);
    lines.push('');
    lines.push('| Name | Kind | Slug | Active | Invocation |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const it of items) {
      lines.push(`| ${it.name} | ${it.kind} | \`${it.slug}\` | ${it.active ? '✅' : '❌'} | ${it.invocation} |`);
    }
    lines.push('');
  }

  lines.push('## Capability Index');
  lines.push('');
  const caps = new Map<string, string[]>();
  for (const it of catalog.all) {
    for (const c of it.capabilities) {
      const list = caps.get(c);
      if (list) list.push(it.slug);
      else caps.set(c, [it.slug]);
    }
  }
  lines.push('| Capability | Resources |');
  lines.push('| --- | --- |');
  for (const [cap, slugs] of [...caps.entries()].sort()) {
    lines.push(`| ${cap} | ${slugs.slice(0, 6).join(', ')}${slugs.length > 6 ? ' …' : ''} |`);
  }
  lines.push('');
  return lines.join('\n');
}
