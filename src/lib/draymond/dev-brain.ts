// ============================================================================
// DEV-BRAIN CLIENT — primary ecosystem decision layer (deterministic)
// ============================================================================
// Dev-Brain (Dev-Brain/, port 3450) is the fleet's primary decision advisor:
// deterministic multi-agent reasoning (candidate triage + weighted decision
// matrix + decision trees), no LLM required. Draymond consults it FIRST for
// ecosystem decisions; if it is down or unconfigured, callers fall back to the
// local harness / deterministic fallbacks — decisions never stall.
//
// Endpoints used:
//   GET  /api/health          liveness
//   POST /api/intake          tool-intake ranking (github-awesome scan)
//   POST /api/decide          weighted decision matrix over candidates
// ============================================================================

export interface DevBrainCandidate {
  id: string;
  title: string;
  description: string;
  tags?: string[];
  license?: string;
  stars?: number;
  language?: string;
  platform?: string;
}

export interface DevBrainMatrixOption {
  id: string;
  title: string;
  description: string;
  weightPercentage: number;
  confidenceScore: number;
  pros: string[];
  cons: string[];
  riskLevel: string;
  expectedROI: string;
  timeToValue: string;
  recommended: boolean;
  verdictTag: string;
  mitigationStrategy: string;
  supportingLeaders: string[];
  scores: Record<string, number>;
}

export interface DevBrainMatrix {
  id: string;
  decisionTopic: string;
  context: string;
  totalOptionsCount: number;
  options: DevBrainMatrixOption[];
  recommendedOptionId: string;
  synthesisRationale: string;
  tradeOffSummary: string;
  generatedBy: string;
  timestamp: string;
  normalizedPercentageSum: number;
}

export interface DevBrainDecideRequest {
  problem: string;
  candidates?: DevBrainCandidate[];
  strategy?: 'balanced_pareto' | 'risk_containment' | 'hyper_velocity' | 'capital_efficiency' | 'deep_tech_scalability';
}

const devBrainUrl = (): string => process.env.DEV_BRAIN_URL ?? 'http://localhost:3450';

async function req<T>(path: string, init?: RequestInit): Promise<T | null> {
  const url = `${devBrainUrl().replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      signal: init?.signal ?? AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** True when Dev-Brain answers /api/health. Never throws. */
export async function devBrainReachable(): Promise<boolean> {
  const health = await req<{ status: string }>('/api/health');
  return health?.status === 'healthy';
}

/** Weighted deterministic decision matrix for a problem + candidates. Never throws. */
export async function devBrainDecide(request: DevBrainDecideRequest): Promise<DevBrainMatrix | null> {
  const body = {
    problem: request.problem,
    strategy: request.strategy,
    candidates: (request.candidates ?? []).map((c) => ({
      name: c.id,
      description: c.description,
      license: c.license,
      stars: c.stars,
      language: c.language,
      platform: c.platform,
      tags: c.tags ?? ['tool'],
    })),
  };
  const matrix = await req<DevBrainMatrix>('/api/decide', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return matrix && Array.isArray(matrix.options) ? matrix : null;
}

/** Scored tool-intake shortlist (used by the github-awesome scan). Never throws. */
export async function devBrainIntake(
  tools: DevBrainCandidate[]
): Promise<{ ranked: unknown[]; topPicks: unknown[]; pruned: unknown[] } | null> {
  return req('/api/intake', {
    method: 'POST',
    body: JSON.stringify({
      tools: tools.map((c) => ({
        name: c.id,
        description: c.description,
        license: c.license,
        stars: c.stars,
        language: c.language,
        platform: c.platform,
        tags: c.tags ?? ['tool'],
      })),
      strategy: 'balanced_pareto',
      problem: 'Dev-Brain intake: candidate open-source tools for the Overlay365 fleet.',
    }),
  });
}