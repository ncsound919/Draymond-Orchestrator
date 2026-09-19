/**
 * Ecosystem status snapshot — the ONE export Open-Chat triggers for an
 * up-to-the-minute view of the ecosystem: revenue pulse, fleet health,
 * strategy + marketing team state, recommended actions, and a plain-language
 * narrative paragraph describing the state of things.
 *
 * Pure aggregation lives in `aggregateSnapshot` (deterministic, unit-testable).
 * `buildEcosystemStatus` gathers live data and adds the narrative (LLM with a
 * registered deterministic fallback — see fallback-registry `status.*`).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { missionDashboard, type MissionDashboard } from './mission-pipeline';
import { getHeartbeats, type HeartbeatRecord } from './heartbeat';
import { kairosFeed, type KairosMoment } from './kairos';
import { defaultMarketingMix, type MarketingDecision } from './marketing-decision';
import { readStrategy, type MissionStrategy } from './mission-strategy';
import { callLLM } from './llm';
import { isDegraded } from './fallbacks';

/** A heartbeat sweep is "fresh" when written within this window. */
const SWEEP_FRESH_MS = 20 * 60 * 1000;

export interface FleetDownAgent {
  slug: string;
  name: string;
  detail: string;
}

export interface CriticalMoment {
  id: string;
  kind: string;
  title: string;
  detail: string;
  lastSeen: string;
  occurrences: number;
}

export interface FleetStatus {
  checked: number;
  up: number;
  down: number;
  sweepFresh: boolean;
  upAgents: Array<{ slug: string; name: string }>;
  downAgents: FleetDownAgent[];
  criticalMoments: CriticalMoment[];
}

export interface TeamStatus {
  strategy: {
    monthlyTarget: number;
    firstDollarByDay: number;
    runwayDays: number;
    services: Array<{ id: string; name: string; targetMonthly: number }>;
  } | null;
  marketing: {
    generatedAt: string;
    recommended: string | null;
    rationale: string | null;
    guard: { allowed: boolean; reason: string } | null;
    allocation: Array<{ id: string; weight: number; recommended: boolean; rationale: string }>;
  } | null;
}

export interface StatusAction {
  priority: 'critical' | 'warn';
  text: string;
}

export interface EcosystemSnapshot {
  generatedAt: string;
  mission: MissionDashboard & { gapUsd: number };
  fleet: FleetStatus;
  teams: TeamStatus;
  actions: StatusAction[];
}

export interface EcosystemStatus extends EcosystemSnapshot {
  ok: true;
  narrative: string;
  narrativeSource: 'llm' | 'fallback';
}

const EMPTY_MISSION: MissionDashboard = {
  revenueUsd: 0,
  totalMonthlyTarget: 0,
  byService: {
    aetherdesk: { target: 0, won: 0, paid: 0 },
    maas: { target: 0, won: 0, paid: 0 },
    audit: { target: 0, won: 0, paid: 0 },
    research: { target: 0, won: 0, paid: 0 },
  },
  opportunities: { total: 0, byStage: {} },
  velocity: { leads: 0, won: 0, invoiced: 0, paid: 0 },
};

export interface SnapshotInput {
  mission: MissionDashboard | null;
  heartbeats: Record<string, HeartbeatRecord> | null;
  moments: KairosMoment[] | null;
  marketing: MarketingDecision | null;
  strategy: MissionStrategy | null;
  sweepFresh: boolean;
  now?: number;
}

/** Deterministic aggregation — no fs, no LLM. Testable pure function. */
export function aggregateSnapshot(input: SnapshotInput): EcosystemSnapshot {
  const now = input.now ?? Date.now();
  const hb = input.heartbeats ?? {};
  const entries = Object.values(hb);
  const up = entries.filter((r) => r.up === true);
  const down = entries.filter((r) => r.up !== true);

  const moments = (input.moments ?? []).filter((m) => !m.acked);
  const criticalMoments = moments
    .filter((m) => m.severity === 'critical')
    .slice(0, 5)
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      title: m.title,
      detail: m.detail,
      lastSeen: m.lastSeen,
      occurrences: m.occurrences,
    }));

  const mission: MissionDashboard = input.mission ?? EMPTY_MISSION;
  const gapUsd = Math.max(0, mission.totalMonthlyTarget - mission.revenueUsd);

  const strategy = input.strategy
    ? {
        monthlyTarget: input.strategy.totalMonthlyTarget,
        firstDollarByDay: input.strategy.firstDollarByDay,
        runwayDays: input.strategy.runwayDays,
        services: input.strategy.services.map((s) => ({
          id: s.id,
          name: s.name,
          targetMonthly: s.targetMonthly,
        })),
      }
    : null;

  let marketing: TeamStatus['marketing'] = null;
  if (input.marketing) {
    const top =
      input.marketing.allocation.find((a) => a.recommended) ??
      input.marketing.allocation[0] ??
      null;
    marketing = {
      generatedAt: input.marketing.generatedAt,
      recommended: top ? top.id : null,
      rationale: top ? top.rationale : null,
      guard: input.marketing.guard,
      allocation: input.marketing.allocation.slice(0, 6),
    };
  }

  const actions: StatusAction[] = [];
  if (!input.sweepFresh) {
    actions.push({
      priority: 'critical',
      text: 'Heartbeat monitor is stale — agent liveness data may be unreliable. Check the heartbeat sweep job.',
    });
  }
  for (const m of criticalMoments.slice(0, 3)) {
    actions.push({
      priority: 'critical',
      text: `${m.title}${m.detail ? ` — ${m.detail}` : ''}`,
    });
  }
  if (mission.totalMonthlyTarget > 0 && mission.revenueUsd < mission.totalMonthlyTarget) {
    if (mission.velocity.leads === 0) {
      actions.push({
        priority: 'warn',
        text: 'No active leads in the pipeline — start outreach to close the revenue gap.',
      });
    }
  }
  if (down.length > 0 && actions.length === 0) {
    actions.push({
      priority: 'warn',
      text: `${down.length} fleet agent${down.length === 1 ? ' is' : 's are'} down.`,
    });
  }

  return {
    generatedAt: new Date(now).toISOString(),
    mission: { ...mission, gapUsd },
    fleet: {
      checked: entries.length,
      up: up.length,
      down: down.length,
      sweepFresh: input.sweepFresh,
      upAgents: up.map((r) => ({ slug: r.slug, name: r.name })).slice(0, 12),
      downAgents: down
        .map((r) => ({ slug: r.slug, name: r.name, detail: r.detail }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 12),
      criticalMoments,
    },
    teams: { strategy, marketing },
    actions: actions.slice(0, 5),
  };
}

/**
 * Deterministic narrative — a tight plain-language paragraph built from the
 * real snapshot numbers. Used as the registry fallback (and as a safety net
 * when the LLM call itself throws). It is a calibrated output: real data,
 * hand-tuned phrasing.
 */
export function buildDeterministicNarrative(snap: EcosystemSnapshot): string {
  const { mission, fleet } = snap;
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const parts: string[] = [];

  if (mission.totalMonthlyTarget > 0) {
    parts.push(
      `Revenue is ${usd(mission.revenueUsd)} of the ${usd(mission.totalMonthlyTarget)} monthly target (${usd(mission.gapUsd)} to go)`
    );
  } else {
    parts.push(`Revenue is ${usd(mission.revenueUsd)} (no monthly target configured)`);
  }

  parts.push(
    `the fleet is ${fleet.up} of ${fleet.checked} agents up` +
      (fleet.down > 0 ? `, ${fleet.down} down` : '') +
      (fleet.sweepFresh ? '' : ' — heartbeat monitor stale, liveness data unreliable')
  );

  if (fleet.criticalMoments.length > 0) {
    const n = fleet.criticalMoments.length;
    parts.push(`with ${n} critical alert${n === 1 ? '' : 's'} open`);
  }

  if (snap.teams.marketing?.recommended) {
    parts.push(`marketing is weighted toward ${snap.teams.marketing.recommended}`);
  }

  const top = snap.actions[0];
  if (top) parts.push(`next priority: ${top.text}`);

  return `${parts.join('. ')}.`;
}

const NARRATIVE_SYSTEM =
  'You are Draymond, the Overlay365 fleet orchestrator, writing a tight status paragraph for the operator. ' +
  'State the current state of the ecosystem in 2-4 plain sentences: revenue pulse vs monthly target, fleet health ' +
  '(agents up/down, monitor freshness), what the strategy and marketing teams are focused on, and the single most ' +
  'important thing to do next. Be concrete with numbers. Honest tone — if revenue is $0 or agents are down, say so ' +
  'plainly. No markdown, no bullets, no preamble.';

function narrativeInput(snap: EcosystemSnapshot): string {
  return JSON.stringify({
    revenueUsd: snap.mission.revenueUsd,
    totalMonthlyTarget: snap.mission.totalMonthlyTarget,
    gapUsd: snap.mission.gapUsd,
    leads: snap.mission.velocity.leads,
    fleetUp: snap.fleet.up,
    fleetDown: snap.fleet.down,
    sweepFresh: snap.fleet.sweepFresh,
    criticals: snap.fleet.criticalMoments.map((m) => m.title),
    downAgents: snap.fleet.downAgents.slice(0, 5).map((a) => a.name),
    strategyTarget: snap.teams.strategy?.monthlyTarget ?? null,
    marketingRecommendation: snap.teams.marketing?.recommended ?? null,
    marketingGuard: snap.teams.marketing?.guard?.reason ?? null,
    actions: snap.actions.map((a) => a.text),
  });
}

async function generateNarrative(
  snap: EcosystemSnapshot
): Promise<{ narrative: string; narrativeSource: 'llm' | 'fallback' }> {
  const source: 'llm' | 'fallback' = isDegraded() ? 'fallback' : 'llm';
  try {
    const narrative = await callLLM({
      system: NARRATIVE_SYSTEM,
      userMessage: narrativeInput(snap),
      maxTokens: 240,
      temperature: 0.4,
      fallbackKey: 'status.ecosystem-narrative',
      fallbackContext: { snapshot: snap },
    });
    const trimmed = (narrative ?? '').trim();
    return {
      narrative: trimmed || buildDeterministicNarrative(snap),
      narrativeSource: trimmed ? source : 'fallback',
    };
  } catch {
    return { narrative: buildDeterministicNarrative(snap), narrativeSource: 'fallback' };
  }
}

async function readSweepFresh(): Promise<boolean> {
  try {
    const dir = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
    const st = await fs.stat(path.join(dir, 'heartbeat-sweep-stamp'));
    return Date.now() - st.mtimeMs < SWEEP_FRESH_MS;
  } catch {
    return false;
  }
}

/** Gather live data and return the full snapshot. Best-effort per source. */
export async function buildEcosystemStatus(): Promise<EcosystemStatus> {
  const [mission, heartbeats, moments, marketing, strategy, sweepFresh] = await Promise.all([
    missionDashboard().catch(() => null),
    getHeartbeats().catch(() => null),
    kairosFeed({ acked: false, limit: 100 }).catch(() => []),
    defaultMarketingMix().catch(() => null),
    readStrategy().catch(() => null),
    readSweepFresh(),
  ]);

  const snapshot = aggregateSnapshot({ mission, heartbeats, moments, marketing, strategy, sweepFresh });
  const narrative = await generateNarrative(snapshot);
  return { ok: true, ...snapshot, ...narrative };
}