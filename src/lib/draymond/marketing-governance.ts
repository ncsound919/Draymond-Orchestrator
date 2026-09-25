// ============================================================================
// MARKETING GOVERNANCE — Dev-Brain decides whether a publish is allowed
// ============================================================================
// The marketing team never self-approves a public action. Every autonomous
// publish is offered to Dev-Brain's governance engine
// (POST /api/governance/evaluate -> AgentIntegrationEngine: hard guardrails +
// circuit breakers + the public_communication decision tree), and Draymond acts
// on the verdict. This replaces the old local "riskLevel" heuristic, which
// could only ever advise.
//
// Modes (env DRAYMOND_MARKETING_GOVERNANCE):
//   enforce (default) — the Dev-Brain verdict gates the publish; if Dev-Brain
//                       is unreachable the publish is HELD (fail-closed).
//   shadow            — always call Dev-Brain, report the verdict, never block.
//   off               — skip governance entirely.
//
// Fail-closed in enforce is deliberate: an unavailable policy brain must never
// silently become "publish everything".
// ============================================================================

import { devBrainGovernanceEvaluate, type DevBrainGovernanceVerdict } from './dev-brain';

export type MarketingGovernanceMode = 'off' | 'shadow' | 'enforce';

/** Parse the configured mode; anything unrecognised falls back to `enforce`. */
export function resolveMarketingGovernanceMode(
  raw: string | undefined = process.env.DRAYMOND_MARKETING_GOVERNANCE
): MarketingGovernanceMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'off' || value === 'shadow' || value === 'enforce') return value;
  return 'enforce';
}

export type MarketingGuardStatus = DevBrainGovernanceVerdict['status'] | 'UNAVAILABLE' | 'SKIPPED';

export interface MarketingGuardResult {
  /** Whether the publish may proceed under the current mode. */
  allowed: boolean;
  reason: string;
  /** True only when Dev-Brain actually answered. */
  evaluated: boolean;
  status: MarketingGuardStatus;
  mode: MarketingGovernanceMode;
  verdict: DevBrainGovernanceVerdict | null;
}

/**
 * Gate one autonomous public-communication action through Dev-Brain.
 * Never throws — an unreachable brain is reported and held (enforce) or
 * allowed-with-report (shadow).
 */
export async function evaluatePublishGuard(input: {
  actionSummary: string;
  /** public_communication scope: 'mass_broadcast' | 'public_social_post' | 'individual_support' | 'financial_refund'. */
  actionScope?: string;
  parameters?: Record<string, unknown>;
  agentId?: string;
  agentName?: string;
}): Promise<MarketingGuardResult> {
  const mode = resolveMarketingGovernanceMode();
  if (mode === 'off') {
    return { allowed: true, evaluated: false, status: 'SKIPPED', mode, reason: 'marketing governance disabled (off)', verdict: null };
  }

  const verdict = await devBrainGovernanceEvaluate({
    actionType: 'public_communication',
    actionSummary: input.actionSummary,
    intent: 'Gate an autonomous marketing publish',
    agentId: input.agentId ?? 'draymond-marketing-team',
    agentName: input.agentName ?? 'Overlay365 Marketing Team',
    parameters: { action_scope: input.actionScope ?? 'public_social_post', ...(input.parameters ?? {}) },
  });

  if (!verdict) {
    // Fail-closed in enforce; shadow reports but allows.
    const allowed = mode !== 'enforce';
    return {
      allowed,
      evaluated: false,
      status: 'UNAVAILABLE',
      mode,
      reason: allowed
        ? 'Dev-Brain governance unreachable — shadow mode allows, verdict not evaluated.'
        : 'Dev-Brain governance unreachable — publish HELD (fail-closed).',
      verdict: null,
    };
  }

  const approved = verdict.status === 'APPROVED' || verdict.status === 'CONDITIONAL_APPROVAL';
  const auths = verdict.requiredAuthorizations?.length ? `; requires ${verdict.requiredAuthorizations.join(', ')}` : '';
  const reason = `Dev-Brain governance ${verdict.status} (risk ${verdict.riskTier})${auths}.`;
  return {
    allowed: mode === 'shadow' ? true : approved,
    evaluated: true,
    status: verdict.status,
    mode,
    reason,
    verdict,
  };
}
