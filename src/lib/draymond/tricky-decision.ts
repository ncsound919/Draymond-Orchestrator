// ============================================================================
// TRICKY DECISION ESCALATION — Draymond → Dev-Brain (JEV) decision path
// ============================================================================
// When Draymond faces a TRICKY situation (ambiguous, high-stakes, no clear
// deterministic answer, or a past lesson says "ask before acting"), it escalates
// here: Dev-Brain's weighted deterministic matrix stays authoritative and its
// JEV (System One) lane adds a calibrated choice advisory over the same options.
//
// Contract (Dev-Brain server.ts, POST /api/decide/jev → { matrix, jev, decidedAt }):
//   - matrix  : deterministic weighted decision matrix (options, weights, verdicts)
//   - jev     : calibrated choice advisory over the same options (source may be
//               'offline' when the gateway + localjev are both unreachable)
//
// This module NEVER fabricates a recommendation: if Dev-Brain is down OR the
// JEV lane is offline, it returns { ok:false, reason:'...' } and the caller
// falls back to its own deterministic handling. Never throws.
// ============================================================================

export type TrickyCategory =
  | 'revenue'
  | 'compliance'
  | 'security'
  | 'client'
  | 'scope'
  | 'budget'
  | 'ambiguous';

export interface TrickySituation {
  /** Short one-line problem statement for the decision matrix. */
  problem: string;
  /** Why this is tricky (drives escalation, not authority). */
  category: TrickyCategory;
  /** Candidate options to rank. At least one. */
  options: Array<{
    id: string;
    title: string;
    description: string;
    tags?: string[];
  }>;
  strategy?: 'balanced_pareto' | 'risk_containment' | 'hyper_velocity' | 'capital_efficiency' | 'deep_tech_scalability';
  /** Optional structured JEV decision state/questions (uses advisory when absent). */
  context?: string;
}

export interface TrickyDecision {
  ok: boolean;
  reason?: string;
  source: 'dev-brain-jevv' | 'dev-brain-deterministic' | 'unavailable';
  matrix: DevBrainJevMatrix | null;
  jev: JevChoiceAdvisory | null;
  recommendedOptionId: string | null;
  decision: string;
  generatedAt: string;
}

/** Shape of Dev-Brain's deterministic matrix (subset we consume). */
export interface DevBrainJevMatrix {
  recommendedOptionId?: string;
  synthesisRationale?: string;
  options?: Array<{ id: string; title?: string; recommended?: boolean }>;
}

/** Shape of Dev-Brain's JEV choice advisory (subset we consume). */
export interface JevChoiceAdvisory {
  source?: 'typesafe' | 'localjev' | 'offline';
  choice?: { optionId?: string; optionKey?: string };
  answers?: Record<string, unknown>;
  note?: string;
}

const devBrainUrl = (): string => process.env.DEV_BRAIN_URL ?? 'http://localhost:3450';

const TRICKY_CATEGORY_HINT: Record<TrickyCategory, string> = {
  revenue: 'revenue is on the line; prefer evidence over momentum',
  compliance: 'compliance/legal exposure; when uncertain escalate rather than act',
  security: 'security boundary; fail closed when the answer is ambiguous',
  client: 'client-facing commitment; do not overpromise under uncertainty',
  scope: 'scope change; confirm before expanding work',
  budget: 'budget constraint; favor capital efficiency under ambiguity',
  ambiguous: 'ambiguous signal; ask before acting when confidence is low',
};

// ============================================================================
// OPERATOR ETHOS (plans/2026-09-22-business-ethos.md) — the COO's judgment.
// These are hard operator decisions, not suggestions.
// ============================================================================

/** Q12 — autonomous discount cap (%): 15% standard, 25% high-margin. */
export const DISCOUNT_CAP_PCT = 15;
export const DISCOUNT_CAP_PCT_HIGH_MARGIN = 25;

/** Q13 — never touch these even when trivially fixable (operator-only). */
export const OPERATOR_ONLY_BOUNDARIES = [
  'contract_terms',
  'legal_claims',
  'invoices',
  'pricing',
  'payouts',
] as const;
export type OperatorOnlyBoundary = (typeof OPERATOR_ONLY_BOUNDARIES)[number];

/** Q3 — repair path order: first available of Axiom/OpenHub, Draymond, Recourse. */
export const REPAIR_FALLBACK_ORDER = ['axiom/openhub', 'draymond', 'recourse'] as const;

/** Q19 — 1–10 severity meter: 8+ contacts the operator outside scheduled updates. */
export const SEVERITY_CONTACT_THRESHOLD = 8;

export interface SeverityInput {
  revenueImpact: 'none' | 'small' | 'large' | 'settled';
  clientFacing: boolean;
  securityFlag: boolean;
  complianceFlag: boolean;
  repeatedFailure: boolean;
  deadlineImminent: boolean;
}

/** Deterministic 1–10 severity score (Q19). 8+ = contact operator now. */
export function severityScore(s: SeverityInput): number {
  let score = 1;
  if (s.securityFlag) score += 4;
  if (s.complianceFlag) score += 4;
  if (s.revenueImpact === 'large') score += 3;
  if (s.revenueImpact === 'settled') score += 1;
  if (s.clientFacing) score += 2;
  if (s.repeatedFailure) score += 2;
  if (s.deadlineImminent) score += 2;
  return Math.min(10, score);
}

/** Q19 — should the operator be contacted now (outside scheduled updates)? */
export function shouldContactOperator(s: SeverityInput): boolean {
  return severityScore(s) >= SEVERITY_CONTACT_THRESHOLD;
}

/** Q12 — is this discount within the operator's autonomous cap? */
export function discountWithinCap(percent: number, highMargin: boolean): boolean {
  return percent <= (highMargin ? DISCOUNT_CAP_PCT_HIGH_MARGIN : DISCOUNT_CAP_PCT);
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  const url = `${devBrainUrl().replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Enrich the problem string with the category hint so the decision matrix
 *  can weigh the right axis. Honest: the hint is guidance, not authority. */
function problemWithHint(s: TrickySituation): string {
  const hint = TRICKY_CATEGORY_HINT[s.category] ?? TRICKY_CATEGORY_HINT.ambiguous;
  return s.context ? `${s.problem} [context: ${s.context}] (${hint})` : `${s.problem} (${hint})`;
}

/**
 * Escalate a tricky situation to Dev-Brain's JEV decision path.
 * Tries POST /api/decide/jev first (matrix + JEV advisory in one hop); if that
 * is unreachable, falls back to the deterministic /api/decide only. Never throws.
 */
export async function escalateTrickyDecision(s: TrickySituation): Promise<TrickyDecision> {
  const generatedAt = new Date().toISOString();
  const body = {
    problem: problemWithHint(s),
    strategy: s.strategy ?? 'balanced_pareto',
    candidates: s.options.map((o) => ({
      name: o.id,
      description: o.description,
      tags: o.tags ?? [],
    })),
  };

  // 1. Primary: Dev-Brain JEV decision (matrix + calibrated advisory).
  const jevResult = await post<{ matrix: DevBrainJevMatrix | null; jev: JevChoiceAdvisory | null }>('/api/decide/jev', body);
  if (jevResult && jevResult.matrix) {
    const recommended = jevResult.matrix.recommendedOptionId ?? null;
    return {
      ok: true,
      source: 'dev-brain-jevv',
      matrix: jevResult.matrix,
      jev: jevResult.jev ?? null,
      recommendedOptionId: recommended,
      decision:
        jevResult.matrix.synthesisRationale ??
        (recommended ? `Recommended: ${recommended}` : 'No explicit recommendation; review options manually.'),
      generatedAt,
    };
  }

  // 2. Fallback: deterministic /api/decide only (no JEV advisory).
  const matrix = await post<DevBrainJevMatrix>('/api/decide', body);
  if (matrix) {
    const recommended = matrix.recommendedOptionId ?? null;
    return {
      ok: true,
      source: 'dev-brain-deterministic',
      matrix,
      jev: null,
      recommendedOptionId: recommended,
      decision:
        matrix.synthesisRationale ?? (recommended ? `Recommended: ${recommended}` : 'No explicit recommendation.'),
      generatedAt,
    };
  }

  // 3. Dev-Brain unreachable — honest unavailable, never a fabricated verdict.
  return { ok: false, reason: 'dev-brain unreachable (no JEV, no matrix)', source: 'unavailable', matrix: null, jev: null, recommendedOptionId: null, decision: '', generatedAt };
}

/**
 * Should this situation go through the JEV escalation path? Deterministic gate:
 * tricky categories + no obvious single best option. Callers use this to decide
 * whether to escalate or handle locally.
 */
export function isTrickySituation(s: TrickySituation): boolean {
  if (s.options.length === 0) return true;
  if (s.options.length < 2) return true;
  if (s.category === 'compliance' || s.category === 'security') return true;
  // Ambiguous: multiple options, none obviously dominant (identical weights).
  return s.category === 'ambiguous' || s.category === 'revenue';
}