import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSeedJobDefs } from '../src/lib/draymond/business-chains';

describe('research data pipeline', () => {
  it('seeds a scheduled job that runs the research-data-pipeline chain', () => {
    const jobs = getSeedJobDefs();
    const feed = jobs.find((j) => j.name === 'Research Data Feed');
    expect(feed).toBeDefined();
    expect(feed!.job_type).toBe('chain');
    const cfg = feed!.job_config as { chain_slug: string; input: { dataset: string; topic: string } };
    expect(cfg.chain_slug).toBe('research-data-pipeline');
    expect(cfg.input.dataset).toBeTruthy();
    expect(cfg.input.topic).toBeTruthy();
  });

  it('defines a chain template referencing kaggle and omni-research', () => {
    // The chain template lives alongside the entity defs; verify the research
    // chain wiring is present in the source so a chain referencing both slugs
    // will resolve when seeded.
    const src = readFileSync(fileURLToPath(new URL('../src/lib/draymond/business-chains.ts', import.meta.url)), 'utf-8');
    expect(src).toContain("slug: 'research-data-pipeline'");
    expect(src).toContain("entitySlug: 'kaggle'");
    expect(src).toContain("entitySlug: 'omni-research'");
    expect(src).toContain("action: 'research_feed'");
    // kaggle must be a seeded entity kind 'tool'
    expect(src).toContain("kind: 'tool'");
    expect(src).toContain("slug: 'kaggle'");
  });
});
