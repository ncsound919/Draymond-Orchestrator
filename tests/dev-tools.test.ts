import { describe, expect, it } from 'vitest';
import { SEED_ENTITIES } from '../src/lib/draymond/seed';

describe('dev tool entities', () => {
  it('registers VibeServe, RepoRank, Grader, and Mutly as agent entities', () => {
    const agentNames = SEED_ENTITIES.filter((e) => e.kind === 'agent').map((e) => e.name.toLowerCase());
    expect(agentNames.some((n) => n.includes('vibeserve'))).toBe(true);
    expect(agentNames.some((n) => n.includes('reporank'))).toBe(true);
    expect(agentNames.some((n) => n.includes('grader'))).toBe(true);
    expect(agentNames.some((n) => n.includes('mutly'))).toBe(true);
  });

  it('gives the four dev-tool agents a valid invocation method', () => {
    for (const slug of ['vibeserve', 'reporank', 'grader', 'mutly']) {
      const agent = SEED_ENTITIES.find((e) => e.slug === slug && e.kind === 'agent');
      expect(agent, `${slug} should be registered as an agent entity`).toBeDefined();
      expect(agent!.invocation_method).toBeDefined();
      expect(agent!.invocation_config).toBeDefined();
    }
  });
});
