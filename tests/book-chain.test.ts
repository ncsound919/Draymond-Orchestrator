import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSeedJobDefs } from '../src/lib/draymond/business-chains';

describe('book-grounded research chain wiring', () => {
  it('seeds a scheduled job that runs the book-grounded-research chain', () => {
    const jobs = getSeedJobDefs();
    const job = jobs.find((j) => j.name === 'Book-Grounded Research');
    expect(job).toBeDefined();
    expect(job!.job_type).toBe('chain');
    expect(job!.cron_expression).toBeTruthy();
    const cfg = job!.job_config as { chain_slug: string; input: { topic: string } };
    expect(cfg.chain_slug).toBe('book-grounded-research');
    expect(cfg.input.topic).toBeTruthy();
  });

  it('defines a chain template referencing bookbridge and book-to-skill-chain', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/draymond/business-chains.ts', import.meta.url)),
      'utf-8'
    );
    expect(src).toContain("slug: 'book-grounded-research'");
    expect(src).toContain("entitySlug: 'bookbridge'");
    expect(src).toContain("entitySlug: 'book-to-skill-chain'");
    expect(src).toContain("action: 'bookbridge_ground'");
    expect(src).toContain("action: 'distill_book_to_skill'");
  });

  it('registers bookbridge as a service entity and book-to-skill-chain as a tool entity', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/draymond/business-chains.ts', import.meta.url)),
      'utf-8'
    );
    expect(src).toContain("slug: 'bookbridge'");
    expect(src).toContain("kind: 'service'");
    expect(src).toContain("slug: 'book-to-skill-chain'");
    expect(src).toContain("kind: 'tool'");
  });

  it('seeds the tpl-book-to-skill-chain template in chains-seed', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/draymond/chains-seed.ts', import.meta.url)),
      'utf-8'
    );
    expect(src).toContain("slug: 'tpl-book-to-skill-chain'");
    expect(src).toContain("requireEntityBySlug('bookbridge')");
    expect(src).toContain("requireEntityBySlug('book-to-skill')");
    expect(src).toContain("action: 'bookbridge_ground'");
  });

  it('registers the github-pull skill in the seed registry', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/lib/draymond/seed.ts', import.meta.url)),
      'utf-8'
    );
    expect(src).toContain("slug: 'github-pull'");
    expect(src).toContain("kind: 'skill'");
  });
});
