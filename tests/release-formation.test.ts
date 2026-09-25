import { describe, expect, it } from 'vitest';

describe('release crew formation', () => {
  it('validates clean (no drift: slugs, reports-to, cell leads)', async () => {
    const { validateReleaseFormation, releaseFormation } = await import(
      '../src/lib/draymond/release-formation'
    );
    const check = validateReleaseFormation();
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);

    const formation = releaseFormation();
    expect(formation.positions.length).toBeGreaterThanOrEqual(20);
    expect(formation.cells).toHaveLength(9);
    expect(formation.rhythm.length).toBeGreaterThanOrEqual(5);
    expect(formation.rules.length).toBeGreaterThanOrEqual(5);
  });

  it('assembles the dev team the operator named', async () => {
    const { releaseCrewSlugs, isReleaseCrewMember } = await import(
      '../src/lib/draymond/release-formation'
    );
    const slugs = releaseCrewSlugs();
    for (const slug of [
      'recourse',
      'recursive-ip',
      'omniresearch-pro',
      'axiom',
      'openhub',
      'cheetah',
      'deterministic-brain',
      'opencode',
    ]) {
      expect(slugs, `missing ${slug}`).toContain(slug);
    }
    expect(isReleaseCrewMember('cheetah')).toBe(true);
    expect(isReleaseCrewMember('not-a-builder')).toBe(false);
  });

  it('carries the cheetah MCP toolchain', async () => {
    const { releaseFormation } = await import('../src/lib/draymond/release-formation');
    const toolchain = releaseFormation().positions.filter((p) => p.cell === 'toolchain');
    const slugs = toolchain.map((p) => p.slug);
    for (const slug of [
      'cheetah',
      'business-logic-mcp',
      'og-glass',
      'ufc-mcp',
      'middle-man-mcp',
      'sub-team',
      'the-beta-team',
      'math-x',
    ]) {
      expect(slugs, `missing toolchain member ${slug}`).toContain(slug);
    }
  });

  it('gives every position a duty, cadence, cell, basis, and chain of command', async () => {
    const { releaseFormation } = await import('../src/lib/draymond/release-formation');
    for (const p of releaseFormation().positions) {
      expect(p.slug, `${p.name} slug`).toBeTruthy();
      expect(p.cell, `${p.slug} cell`).toBeTruthy();
      expect(['always-on', 'shift', 'on-call']).toContain(p.duty);
      expect(p.cadence.length, `${p.slug} cadence`).toBeGreaterThan(0);
      expect(Array.isArray(p.outputs), `${p.slug} outputs`).toBe(true);
      expect(
        ['deterministic', 'ai', 'measured', 'orchestration', 'knowledge', 'external'],
        `${p.slug} basis`
      ).toContain(p.basis);
    }
  });

  it('marks not-in-tree tools unavailable instead of faking them', async () => {
    const { releaseFormation } = await import('../src/lib/draymond/release-formation');
    const bySlug = new Map(releaseFormation().positions.map((p) => [p.slug, p]));
    expect(bySlug.get('og-glass')?.available).toBe(false);
    expect(bySlug.get('math-x')?.available).toBe(false);
    expect(bySlug.get('cheetah')?.invocation).toBe('cli_command');
  });

  it('renders a markdown formation without throwing', async () => {
    const { releaseFormationMarkdown } = await import('../src/lib/draymond/release-formation');
    const md = releaseFormationMarkdown();
    expect(md).toContain('# Release Crew Formation (Software Factory)');
    expect(md).toContain('Overlay Cheetah V3 Pro');
    expect(md).toContain('Rules of Engagement');
  });
});
