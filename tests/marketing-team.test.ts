import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';

const QUEUE_FILE = join(tmpdir(), 'draymond-mkt-queue-test.json');

// Point Dev-Brain at a closed port so the unreachable-fallback paths are
// exercised deterministically (no dependency on a live fleet in CI).
beforeAll(() => {
  process.env.DEV_BRAIN_URL = 'http://127.0.0.1:9';
  process.env.MARKETING_QUEUE_FILE = QUEUE_FILE;
  // Keep the pulse tests deterministic — do not spawn the Overlay365 team.
  process.env.DRAYMOND_MARKETING_PULSE_SPAWN = '0';
});

afterAll(() => {
  rmSync(QUEUE_FILE, { force: true });
});

describe('marketing team roster', () => {
  it('includes the Observer, her members, the Content Engine, and the OSS stack', async () => {
    const { MARKETING_TEAM, marketingTeamSummary, isMarketingTeamMember, marketingTeamSlugs } = await import(
      '../src/lib/draymond/marketing-team'
    );
    const slugs = marketingTeamSlugs();
    expect(slugs).toContain('image-gen');
    expect(slugs).toContain('overlay-marketing-voice');
    expect(slugs).toContain('overlay-marketing-tracker');
    expect(slugs).toContain('overlay-content'); // the Content Engine
    expect(slugs).toContain('oss-listmonk');
    expect(isMarketingTeamMember('overlay-content')).toBe(true);
    expect(isMarketingTeamMember('not-a-marketer')).toBe(false);
    expect(marketingTeamSummary()).toContain('draymond');
    expect(MARKETING_TEAM.length).toBeGreaterThanOrEqual(12);
  });

  it('labels the provenance of every member (no fabricated basis)', async () => {
    const { marketingTeamByBasis } = await import('../src/lib/draymond/marketing-team');
    const by = marketingTeamByBasis();
    expect(by.deterministic.map((m) => m.slug)).toContain('overlay-marketing-voice');
    expect(by.ai.map((m) => m.slug)).toContain('image-gen');
    expect(by.measured.map((m) => m.slug)).toContain('overlay-marketing-tracker');
    expect(by.knowledge.map((m) => m.slug)).toContain('marketingskills');
  });
});

describe('gatherMarketingSkills', () => {
  it('returns a well-formed skills inventory', async () => {
    const { gatherMarketingSkills } = await import('../src/lib/draymond/marketing-team');
    const skills = await gatherMarketingSkills();
    expect(Array.isArray(skills.registered)).toBe(true);
    expect(skills.registeredCount).toBe(skills.registered.length);
    expect(typeof skills.onDiskCount).toBe('number');
    expect(skills.root).toContain('marketingskills');
  });
});

describe('marketing operative formation', () => {
  it('slots every roster member and validates clean', async () => {
    const { validateMarketingFormation, marketingFormation } = await import(
      '../src/lib/draymond/marketing-formation'
    );
    const check = validateMarketingFormation();
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);

    const formation = marketingFormation();
    expect(formation.positions.length).toBeGreaterThanOrEqual(20);
    expect(formation.cells).toHaveLength(8);
    expect(formation.rhythm.length).toBeGreaterThanOrEqual(5);
    expect(formation.rules.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every position a duty, cadence, cell, and chain of command', async () => {
    const { marketingFormation } = await import('../src/lib/draymond/marketing-formation');
    for (const p of marketingFormation().positions) {
      expect(p.slug, `${p.name} slug`).toBeTruthy();
      expect(p.cell, `${p.slug} cell`).toBeTruthy();
      expect(['always-on', 'shift', 'on-call']).toContain(p.duty);
      expect(p.cadence.length, `${p.slug} cadence`).toBeGreaterThan(0);
      expect(Array.isArray(p.outputs), `${p.slug} outputs`).toBe(true);
    }
  });

  it('renders a markdown formation without throwing', async () => {
    const { marketingFormationMarkdown } = await import('../src/lib/draymond/marketing-formation');
    const md = marketingFormationMarkdown();
    expect(md).toContain('# Marketing Operative Formation');
    expect(md).toContain('Command: Draymond');
    expect(md).toContain('Rules of Engagement');
  });
});

describe('runMarketingPulse', () => {
  it('reports an absent queue honestly and still returns the Dev-Brain mix', async () => {
    rmSync(QUEUE_FILE, { force: true });
    const { runMarketingPulse } = await import('../src/lib/draymond/marketing-team');
    const pulse = await runMarketingPulse();
    expect(pulse.queueFound).toBe(false);
    expect(pulse.pendingPosts).toBe(0);
    expect(pulse.note).toContain('not found');
    expect(pulse.mix.devBrainConsulted).toBe(false);
    expect(pulse.mix.topChannel).toBeTruthy();
    expect(pulse.deterministic).toBeNull();
  });

  it('counts real pending posts by platform when the queue exists', async () => {
    writeFileSync(
      QUEUE_FILE,
      JSON.stringify([{ platform: 'x' }, { platform: 'x' }, { platform: 'linkedin' }, { text: 'no platform' }]),
      'utf8'
    );
    const { runMarketingPulse } = await import('../src/lib/draymond/marketing-team');
    const pulse = await runMarketingPulse();
    expect(pulse.queueFound).toBe(true);
    expect(pulse.pendingPosts).toBe(4);
    expect(pulse.byPlatform.x).toBe(2);
    expect(pulse.byPlatform.linkedin).toBe(1);
    expect(pulse.byPlatform.unknown).toBe(1);
  });
});

describe('runDeterministicPulse', () => {
  it('reports a missing team dir without spawning', async () => {
    const prev = process.env.MARKETING_TEAM_DIR;
    process.env.MARKETING_TEAM_DIR = join(tmpdir(), 'definitely-no-marketing-team');
    const { runDeterministicPulse } = await import('../src/lib/draymond/marketing-team');
    const result = await runDeterministicPulse();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
    process.env.MARKETING_TEAM_DIR = prev;
  });
});

describe('marketing governance (Dev-Brain decides)', () => {
  it('holds the publish (fail-closed) when Dev-Brain is unreachable in enforce mode', async () => {
    process.env.DRAYMOND_MARKETING_GOVERNANCE = 'enforce';
    const { evaluatePublishGuard } = await import('../src/lib/draymond/marketing-governance');
    const gate = await evaluatePublishGuard({ actionSummary: 'publish test' });
    expect(gate.mode).toBe('enforce');
    expect(gate.evaluated).toBe(false);
    expect(gate.status).toBe('UNAVAILABLE');
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('HELD');
  });

  it('reports but allows when Dev-Brain is unreachable in shadow mode', async () => {
    process.env.DRAYMOND_MARKETING_GOVERNANCE = 'shadow';
    const { evaluatePublishGuard } = await import('../src/lib/draymond/marketing-governance');
    const gate = await evaluatePublishGuard({ actionSummary: 'publish test' });
    expect(gate.mode).toBe('shadow');
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toContain('shadow mode allows');
  });

  it('skips entirely when governance is off', async () => {
    process.env.DRAYMOND_MARKETING_GOVERNANCE = 'off';
    const { evaluatePublishGuard } = await import('../src/lib/draymond/marketing-governance');
    const gate = await evaluatePublishGuard({ actionSummary: 'publish test' });
    expect(gate.status).toBe('SKIPPED');
    expect(gate.allowed).toBe(true);
  });

  it('defaults to enforce for an unrecognised mode', async () => {
    const { resolveMarketingGovernanceMode } = await import('../src/lib/draymond/marketing-governance');
    expect(resolveMarketingGovernanceMode('bogus')).toBe('enforce');
  });

  it('decideMarketingMix ties the publish guard to Dev-Brain governance', async () => {
    process.env.DRAYMOND_MARKETING_GOVERNANCE = 'enforce';
    const { decideMarketingMix } = await import('../src/lib/draymond/marketing-decision');
    const decision = await decideMarketingMix({
      campaigns: [{ id: 'launch', title: 'Launch X', channel: 'postiz' }],
    });
    expect(decision.guard?.allowed).toBe(false);
  });
});

describe('runMarketingStrategy (Dev-Brain unreachable)', () => {
  it('falls back honestly and still returns a full structure', async () => {
    const { runMarketingStrategy } = await import('../src/lib/draymond/marketing-team');
    const strategy = await runMarketingStrategy();
    expect(strategy.marketingDevBrainConsulted).toBe(false);
    expect(strategy.allocation.length).toBeGreaterThan(0);
    expect(strategy.candidateStrategies.length).toBeGreaterThanOrEqual(2);
    expect(strategy.strategyTeam).toBeNull();
    expect(strategy.honestNotes.join(' ')).toContain('unreachable');
    expect(strategy.recommended.channelId).toBeTruthy();
  });

  it('skips strategy-team ranking when fewer than 2 candidates are supplied', async () => {
    const { runMarketingStrategy } = await import('../src/lib/draymond/marketing-team');
    const strategy = await runMarketingStrategy({
      proposals: [{ id: 'only', title: 'Only bet', description: 'single candidate' }],
    });
    expect(strategy.strategyTeam).toBeNull();
    expect(strategy.honestNotes.join(' ')).toContain('Fewer than 2');
  });
});

describe('runMarketingPublishDrain', () => {
  it('holds every queued post when PUBLISH_DRY_RUN is on (the default)', async () => {
    delete process.env.PUBLISH_DRY_RUN;
    writeFileSync(
      QUEUE_FILE,
      JSON.stringify([
        { platform: 'x', text: 'hello world' },
        { platform: 'linkedin', text: 'second post' },
      ])
    );
    const { runMarketingPublishDrain } = await import('../src/lib/draymond/marketing-team');
    const res = await runMarketingPublishDrain();
    expect(res.dryRun).toBe(true);
    expect(res.queueFound).toBe(true);
    expect(res.checked).toBe(2);
    expect(res.published).toBe(0);
    expect(res.held).toBe(2);
    expect(res.outcomes.every((o) => o.detail.includes('PUBLISH_DRY_RUN'))).toBe(true);
  });

  it('reports an absent queue honestly instead of a fake publish', async () => {
    rmSync(QUEUE_FILE, { force: true });
    const { runMarketingPublishDrain } = await import('../src/lib/draymond/marketing-team');
    const res = await runMarketingPublishDrain();
    expect(res.queueFound).toBe(false);
    expect(res.published).toBe(0);
    expect(res.note).toMatch(/not found/);
  });
});
