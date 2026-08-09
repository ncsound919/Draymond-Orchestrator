import { describe, expect, it } from 'vitest';
import {
  TOOL_PORTS,
  toolBySlug,
  toolUrl,
  toolHealthUrl,
  toolCount,
  findPortCollisions,
  portRegistrySummary,
} from '../src/lib/draymond/ports';

describe('tool port registry', () => {
  it('assigns a unique port to every HTTP tool (no collisions)', () => {
    const collisions = findPortCollisions();
    expect(collisions).toEqual([]);
  });

  it('has a healthy toolcount and covers the definitive stack', () => {
    expect(toolCount()).toBeGreaterThanOrEqual(25);
    for (const slug of ['reporank', 'grader', 'mutly', 'agent-browser', 'megacode', 'vibeserve', 'claw-protect', 'big-homie', 'sub-team', 'uplift-agent', 'graphify', 'deterministic-brain']) {
      expect(toolBySlug(slug), `missing ${slug}`).toBeDefined();
    }
  });

  it('keeps Draymond on 3444 and spreads key tools off the crowded ports', () => {
    expect(toolBySlug('draymond')?.port).toBe(3444);
    // Previously everything fought over 3000 / 3001 / 8000 / 4000:
    expect(toolBySlug('agent-browser')?.port).toBe(3700);
    expect(toolBySlug('reporank')?.port).toBe(3200);
    expect(toolBySlug('grader')?.port).toBe(3201);
    expect(toolBySlug('litellm')?.port).toBe(4100);
    expect(toolBySlug('vibeserve')?.port).toBe(3600);
    expect(toolBySlug('claw-protect')?.port).toBe(3300);
    expect(toolBySlug('bet-buddy')?.port).toBe(3001); // untouched
    expect(toolBySlug('graphify')?.port).toBe(3203);
    expect(toolBySlug('deterministic-brain')?.port).toBe(3210);
  });

  it('resolves canonical base and health URLs', () => {
    expect(toolUrl('reporank')).toBe('http://localhost:3200');
    // RepoRank's real health route is GET /health (its API app serves it at the
    // root, not /api/health).
    expect(toolHealthUrl('reporank')).toBe('http://localhost:3200/health');
    expect(toolHealthUrl('agent-browser')).toBe('http://localhost:3700/api/health');
    // stdio-only tools have no HTTP URL
    expect(toolUrl('ufc-mcp')).toBeNull();
    expect(toolHealthUrl('ufc-mcp')).toBeNull();
  });

  it('documents an env var and a start command for every tool', () => {
    for (const t of TOOL_PORTS) {
      expect(t.env, `${t.slug} needs an env var`).toBeTruthy();
    }
    // Locally-runnable HTTP tools (have a cwd) need a start hint; ecosystem
    // services the user boots separately are documented via their env/port only.
    for (const t of TOOL_PORTS.filter((x) => x.port !== null && x.cwd)) {
      expect(t.start, `${t.slug} needs a start hint`).toBeTruthy();
    }
  });

  it('produces a summary that mentions the toolcount and no collisions', () => {
    const summary = portRegistrySummary();
    expect(summary).toContain(`${TOOL_PORTS.length} tools`);
    expect(summary).not.toContain('PORT COLLISIONS');
  });
});
