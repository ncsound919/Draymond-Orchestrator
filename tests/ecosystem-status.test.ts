import { describe, expect, it, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// heartbeat.ts reads DRAYMOND_REGISTRY_DIR at module scope, so it is mocked
// (its real sweep is covered by heartbeat.test.ts). All other sources read the
// registry dir lazily at call time — pointing it at a tmp dir makes the test
// fully offline and deterministic.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-ecosystem-status-'));
process.env.DRAYMOND_REGISTRY_DIR = tmp;

vi.mock('../src/lib/draymond/heartbeat', () => ({
  getHeartbeats: vi.fn(async () => ({})),
}));
// LLM + marketing-decision are mocked so buildEcosystemStatus runs fully
// offline and deterministically in tests.
vi.mock('../src/lib/draymond/llm', () => ({
  callLLM: vi.fn(async () => 'Revenue is $0 of the $33k target with 3 fleet agents up.'),
}));
vi.mock('../src/lib/draymond/marketing-decision', () => ({
  defaultMarketingMix: vi.fn(async () => ({
    generatedAt: '2026-09-02T00:00:00.000Z',
    devBrainConsulted: false,
    matrix: null,
    allocation: [
      { id: 'listmonk', weight: 40, recommended: true, rationale: 'Owned audience, highest LTV.' },
      { id: 'twenty', weight: 30, recommended: false, rationale: 'Pipeline + dealflow.' },
      { id: 'postiz', weight: 20, recommended: false, rationale: 'Rented reach, fast iteration.' },
      { id: 'umami', weight: 10, recommended: false, rationale: 'Trend feed.' },
    ],
    guard: { allowed: true, reason: 'Channel mix approved.' },
  })),
}));

import {
  aggregateSnapshot,
  buildDeterministicNarrative,
  buildEcosystemStatus,
} from '../src/lib/draymond/ecosystem-status';
import type { MissionDashboard } from '../src/lib/draymond/mission-pipeline';
import type { KairosMoment } from '../src/lib/draymond/kairos';

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MISSION: MissionDashboard = {
  revenueUsd: 2500,
  totalMonthlyTarget: 33000,
  byService: {
    aetherdesk: { target: 12000, won: 500, paid: 2500 },
    maas: { target: 12000, won: 0, paid: 0 },
    audit: { target: 6000, won: 0, paid: 0 },
    research: { target: 3000, won: 0, paid: 0 },
  },
  opportunities: { total: 3, byStage: { lead: 2, won: 1 } },
  velocity: { leads: 2, won: 1, invoiced: 0, paid: 0 },
};

const MOMENT: KairosMoment = {
  id: 'km_test_1',
  kind: 'stale_heartbeat',
  severity: 'critical',
  title: 'Agent heartbeat stale: Megacode',
  detail: 'down — last seen 100m',
  source: 'heartbeats',
  firstSeen: '2026-09-01T00:00:00.000Z',
  lastSeen: '2026-09-01T23:00:00.000Z',
  occurrences: 3,
  hash: 'x',
  acked: false,
};

describe('aggregateSnapshot', () => {
  it('computes revenue gap, fleet counts, and dedupes critical moments', () => {
    const snap = aggregateSnapshot({
      mission: { ...MISSION, velocity: { ...MISSION.velocity, leads: 0 } },
      heartbeats: {
        a: { slug: 'a', name: 'Alpha', last_seen: '', up: true, detail: 'HTTP 200' },
        b: { slug: 'b', name: 'Beta', last_seen: '', up: false, detail: 'fetch failed' },
      },
      moments: [MOMENT, { ...MOMENT, acked: true, id: 'km_test_acked' }],
      marketing: null,
      strategy: null,
      sweepFresh: false,
      now: 1_752_000_000_000,
    });

    expect(snap.mission.gapUsd).toBe(30500);
    expect(snap.fleet.checked).toBe(2);
    expect(snap.fleet.up).toBe(1);
    expect(snap.fleet.down).toBe(1);
    expect(snap.fleet.sweepFresh).toBe(false);
    expect(snap.fleet.criticalMoments).toHaveLength(1);
    expect(snap.fleet.criticalMoments[0].id).toBe('km_test_1');
    expect(snap.fleet.downAgents[0].slug).toBe('b');

    // Stale monitor + critical moment + no-lead warn all surface as actions.
    const priorities = snap.actions.map((a) => a.priority);
    expect(priorities).toContain('critical');
    expect(priorities).toContain('warn');
  });

  it('handles a null mission and no heartbeats (degraded empty state)', () => {
    const snap = aggregateSnapshot({
      mission: null,
      heartbeats: null,
      moments: null,
      marketing: null,
      strategy: null,
      sweepFresh: false,
    });
    expect(snap.mission.revenueUsd).toBe(0);
    expect(snap.mission.gapUsd).toBe(0);
    expect(snap.fleet.checked).toBe(0);
    expect(snap.teams.strategy).toBeNull();
    expect(snap.teams.marketing).toBeNull();
  });

  it('exposes strategy services and the top marketing recommendation', () => {
    const snap = aggregateSnapshot({
      mission: MISSION,
      heartbeats: {},
      moments: [],
      marketing: {
        generatedAt: '2026-09-02T00:00:00.000Z',
        devBrainConsulted: false,
        matrix: null,
        allocation: [
          { id: 'listmonk', weight: 40, recommended: true, rationale: 'Owned audience.' },
          { id: 'twenty', weight: 30, recommended: false, rationale: 'CRM.' },
        ],
        guard: { allowed: true, reason: 'Approved.' },
      },
      strategy: {
        services: [{ id: 'maas', name: 'Marketing-as-a-Service', targetMonthly: 2000 }],
        totalMonthlyTarget: 5000,
        firstDollarByDay: 30,
        runwayDays: 90,
        updatedAt: '',
      } as unknown as Parameters<typeof aggregateSnapshot>[0]['strategy'],
      sweepFresh: true,
    });

    expect(snap.teams.strategy?.monthlyTarget).toBe(5000);
    expect(snap.teams.strategy?.services[0].id).toBe('maas');
    expect(snap.teams.marketing?.recommended).toBe('listmonk');
    expect(snap.teams.marketing?.guard?.allowed).toBe(true);
    expect(snap.actions.some((a) => a.priority === 'critical')).toBe(false);
  });
});

describe('buildDeterministicNarrative', () => {
  it('builds an honest paragraph from real numbers', () => {
    const snap = aggregateSnapshot({
      mission: MISSION,
      heartbeats: { a: { slug: 'a', name: 'Alpha', last_seen: '', up: true, detail: '' } },
      moments: [MOMENT],
      marketing: null,
      strategy: null,
      sweepFresh: false,
    });
    const text = buildDeterministicNarrative(snap);
    expect(text).toContain('Revenue is $2,500');
    expect(text).toContain('$33,000 monthly target');
    expect(text).toContain('1 of 1 agents up');
    expect(text).toContain('critical alert');
    expect(text).toContain('heartbeat monitor stale');
  });
});

describe('buildEcosystemStatus', () => {
  it('gathers live data and returns a full packaged snapshot', async () => {
    const status = await buildEcosystemStatus();

    expect(status.ok).toBe(true);
    expect(typeof status.generatedAt).toBe('string');
    expect(status.narrativeSource).toBe('llm');
    expect(status.narrative.length).toBeGreaterThan(10);
    // Real file-backed sources degrade to empty in a fresh tmp registry; the
    // strategy target comes from mission-strategy DEFAULT_STRATEGY ($5k).
    expect(status.mission.revenueUsd).toBe(0);
    expect(status.mission.totalMonthlyTarget).toBe(5000);
    expect(status.fleet.checked).toBe(0);
    expect(status.teams.strategy).not.toBeNull();
    expect(status.teams.marketing?.recommended).toBe('listmonk');
    expect(status.actions.length).toBeGreaterThan(0); // stale monitor action
  });
});