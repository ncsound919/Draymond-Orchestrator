import { describe, expect, it } from 'vitest';
import { SEED_ENTITIES } from '../src/lib/draymond/seed';

const DEV_TOOL_SLUGS = ['vibeserve', 'reporank', 'grader', 'mutly'];

describe('dev tool entities', () => {
  it('registers VibeServe, RepoRank, Grader, and Mutly in the registry', () => {
    const slugs = new Set(SEED_ENTITIES.map((e) => e.slug));
    for (const slug of DEV_TOOL_SLUGS) {
      expect(slugs.has(slug), `${slug} should be registered`).toBe(true);
    }
  });

  it('gives every dev-tool entity a valid invocation method and config', () => {
    for (const slug of DEV_TOOL_SLUGS) {
      const entity = SEED_ENTITIES.find((e) => e.slug === slug);
      expect(entity, `${slug} should exist in the seed`).toBeDefined();
      expect(entity!.invocation_method).toBeDefined();
      expect(entity!.invocation_config).toBeDefined();
    }
  });

  it('registers VibeServe as an mcp_stdio tool with the python entrypoint', () => {
    const vibe = SEED_ENTITIES.find((e) => e.slug === 'vibeserve');
    expect(vibe).toBeDefined();
    expect(vibe!.kind).toBe('tool');
    expect(vibe!.invocation_method).toBe('mcp_stdio');
    const config = vibe!.invocation_config as { command: string; args: string[] };
    expect(config.command).toBe('python');
    expect(config.args).toEqual(['agents/VibeServe-main/vibeserve/__main__.py']);
  });
});
