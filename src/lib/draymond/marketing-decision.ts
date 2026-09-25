// ============================================================================
// MARKETING DECISION ENGINE — Dev-Brain backed channel & campaign weighting
// ============================================================================
// The marketing fleet (SMD + OSS stack: Shlink, Postiz, Listmonk, Twenty,
// Formbricks, Umami) needs a deterministic way to allocate budget/effort
// across channels and to gate autonomous publishing. This module is the
// single seam:
//
//   1. Decide: weight channels/campaigns via Dev-Brain POST /api/marketing/decide
//      (deterministic, auditable, no LLM). Falls back to equal-weight when
//      Dev-Brain is down — decisions never stall.
//   2. Guard: the Dev-Brain governance engine (marketing-governance.ts) decides
//      whether an autonomous publish is allowed. In enforce mode (default) a
//      non-approved verdict — or an unreachable Dev-Brain — HOLDS the publish.
//
// The allocation matrix is advisory; the publish guard is enforcing. Set
// DRAYMOND_MARKETING_GOVERNANCE=shadow to report-without-blocking.
// ============================================================================

import { devBrainMarketingDecide, type DevBrainCandidate, type DevBrainMatrix } from './dev-brain';
import { evaluatePublishGuard } from './marketing-governance';

export interface MarketingChannel {
  id: string;
  name: string;
  platform: string; // e.g. 'postiz' | 'listmonk' | 'twenty' | 'umami' | 'shlink'
  description?: string;
  monthlyBudget?: number;
  tags?: string[];
}

export interface MarketingCampaign {
  id: string;
  title: string;
  channel: string;
  description?: string;
  expectedReach?: number;
  tags?: string[];
}

export interface MarketingDecision {
  generatedAt: string;
  devBrainConsulted: boolean;
  matrix: DevBrainMatrix | null;
  allocation: Array<{ id: string; weight: number; recommended: boolean; rationale: string }>;
  guard: { allowed: boolean; reason: string } | null;
}

/**
 * Weight marketing channels or campaigns via Dev-Brain.
 * Never throws — returns best-effort decision (equal-weight fallback).
 */
export async function decideMarketingMix(opts: {
  problem?: string;
  channels?: MarketingChannel[];
  campaigns?: MarketingCampaign[];
  strategy?: DevBrainCandidate['tags'] extends unknown ? string : never;
  strategyKey?: 'balanced_pareto' | 'capital_efficiency' | 'hyper_velocity' | 'risk_containment';
}): Promise<MarketingDecision> {
  const generatedAt = new Date().toISOString();
  const candidates: DevBrainCandidate[] = [];

  for (const ch of opts.channels ?? []) {
    candidates.push({
      id: `channel:${ch.id}`,
      title: ch.name,
      description: ch.description ?? `${ch.platform} — monthly budget $${ch.monthlyBudget ?? 'TBD'}`,
      tags: ['marketing', 'channel', ch.platform, ...(ch.tags ?? [])],
    });
  }
  for (const cp of opts.campaigns ?? []) {
    candidates.push({
      id: `campaign:${cp.id}`,
      title: cp.title,
      description: cp.description ?? `${cp.channel} — expected reach ${cp.expectedReach ?? 'TBD'}`,
      tags: ['marketing', 'campaign', cp.channel, ...(cp.tags ?? [])],
    });
  }

  const problem =
    opts.problem ??
    'Marketing mix allocation: weight channels and campaigns by attributable revenue, CAC payback, audience ownership (list/CRM = owned, social = rented), and execution speed. Highest weight = fund first.';

  // Try Dev-Brain (deterministic, 15s timeout inside client).
  let matrix: DevBrainMatrix | null = null;
  let devBrainConsulted = false;
  try {
    matrix = await devBrainMarketingDecide({
      problem,
      candidates: candidates.length ? candidates : [{ id: 'channel:hold', title: 'Hold spend', description: problem, tags: ['marketing'] }],
      strategy: (opts.strategyKey as DevBrainCandidate['tags'] extends never ? never : never) ?? (opts.strategyKey as unknown as 'capital_efficiency') ?? 'capital_efficiency',
    });
    devBrainConsulted = Boolean(matrix);
  } catch {
    devBrainConsulted = false;
  }

  // Build allocation from matrix or equal-weight fallback.
  let allocation: MarketingDecision['allocation'];
  if (matrix && matrix.options.length > 0) {
    allocation = matrix.options.map((o) => ({
      id: o.id,
      weight: o.weightPercentage,
      recommended: o.id === matrix!.recommendedOptionId,
      rationale: o.mitigationStrategy ?? o.description.slice(0, 160),
    }));
  } else {
    const n = Math.max(1, candidates.length);
    const share = Math.floor(100 / n);
    allocation = (candidates.length ? candidates : [{ id: 'channel:hold', title: 'Hold' } as unknown as DevBrainCandidate]).map((c, i) => ({
      id: c.id,
      weight: i === 0 ? 100 - share * (n - 1) : share,
      recommended: i === 0,
      rationale: 'Equal-weight fallback — Dev-Brain unreachable, no deterministic ranking available.',
    }));
  }

  // Guard: Dev-Brain governance decides whether an autonomous publish is
  // allowed (fail-closed in enforce mode). This is the published-action gate —
  // not a local risk heuristic. Channel-mix-only calls need no publish gate.
  let guard: MarketingDecision['guard'];
  const campaigns = opts.campaigns ?? [];
  if (campaigns.length > 0) {
    const g = await evaluatePublishGuard({
      actionSummary: `Autonomous marketing publish: ${campaigns.map((c) => c.title).join(', ').slice(0, 240)}`,
      actionScope: 'mass_broadcast',
      parameters: { campaign_count: campaigns.length, contains_future_promises: false },
    });
    guard = { allowed: g.allowed, reason: g.reason };
  } else {
    guard = { allowed: true, reason: 'Channel mix only — no autonomous publish; public-communication gate not required.' };
  }

  return { generatedAt, devBrainConsulted, matrix, allocation, guard };
}

/** Shorthand: default channel mix for the OSS marketing stack (advisory). */
export async function defaultMarketingMix(): Promise<MarketingDecision> {
  return decideMarketingMix({
    problem: 'Default OSS marketing stack allocation for the Overlay365 fleet: Shlink (owned links), Postiz (social), Listmonk (email), Twenty (CRM), Formbricks (survey), Umami (analytics). Weight by owned-audience durability first.',
    channels: [
      { id: 'listmonk', name: 'Listmonk — email', platform: 'listmonk', description: 'Owned audience, highest LTV. Aggressive list growth.' },
      { id: 'twenty', name: 'Twenty — CRM', platform: 'twenty', description: 'Pipeline + dealflow. Revenue engine E2-b2b.' },
      { id: 'postiz', name: 'Postiz — social', platform: 'postiz', description: 'Rented reach, fast iteration. Risk: algorithm dependency.' },
      { id: 'shlink', name: 'Shlink — links', platform: 'shlink', description: 'Attribution backbone for all campaigns.' },
      { id: 'formbricks', name: 'Formbricks — surveys', platform: 'formbricks', description: 'Lead capture + NPS. Low cost, high signal.' },
      { id: 'umami', name: 'Umami — analytics', platform: 'umami', description: 'Trend/anomaly feed for the strategy team.' },
    ],
    strategyKey: 'capital_efficiency',
  });
}
