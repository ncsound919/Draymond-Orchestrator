// ============================================================================
// DRAYMOND AUDIT TEAM — the definitive audit / verification toolset
// ============================================================================
// Canonical roster of every auditing tool the fleet runs. Analogous to
// coding-stack.ts: one source that says who is on the audit team, what each
// member does, and on what basis it produces its numbers.
//
// "Register, don't move": the tools stay at their physical locations. This
// module is the registration/declaration — no paths are relocated, so pm2
// configs, fleet-manifest, and hardcoded service paths keep working.
//
// Honesty contract (AGENTS.md brutal-honesty override): every member declares
// its `basis` — deterministic static analysis, AI model output, real
// measurement, or pure orchestration. Nothing here fabricates a score, and
// AI-generated scores are never presented as independent measurements.
// ============================================================================

/** Where a member's numbers actually come from. */
export type AuditBasis = 'deterministic' | 'ai' | 'measured' | 'orchestration';

export interface AuditTeamMember {
  /** Entity slug — matches draymond_entities.slug where registered. */
  slug: string;
  name: string;
  /** What the member audits / what it is for. */
  role: string;
  basis: AuditBasis;
  kind: 'agent' | 'tool' | 'service' | 'pipeline';
  /**
   * Repo-relative location of the tool, or null for a pure orchestrator.
   * Relative to the Uplift root unless it starts with a drive letter.
   */
  location: string | null;
  /** Env var that points at the service, when it is an HTTP service. */
  env?: string;
  /** Canonical port, when it is an HTTP service. */
  port?: number | null;
  /** Health/primary endpoint, when it is an HTTP service. */
  endpoint?: string | null;
  /** Invocation method used by the entity registry. */
  invocation: 'http_api' | 'cli_command' | 'subprocess' | 'internal' | 'pipeline';
  /** Honest one-line note on capability or known gap. */
  notes: string;
}

/** The audit team — deterministic first, then AI scorers, then orchestration. */
export const AUDIT_TEAM: AuditTeamMember[] = [
  {
    slug: 'overlay-auditor',
    name: 'The Auditor',
    role: 'Deterministic site integrity (uptime, broken links, payment-link resolution)',
    basis: 'deterministic',
    kind: 'agent',
    location: '01_Platforms/Overlay365/agent-team/agents/auditor',
    invocation: 'cli_command',
    notes: 'Read-only checks against live Overlay365 sites. Never executes a payment. Pass/fail structure, no LLM.',
  },
  {
    slug: 'codegang',
    name: 'Codegang',
    role: 'Multi-scanner deep analysis (security, bugs, prompt-injection, edge-cases, deps)',
    basis: 'deterministic',
    kind: 'tool',
    location: '05_Apps/Codegang',
    env: 'CODEGANG_URL',
    port: 3204,
    endpoint: '/api',
    invocation: 'http_api',
    notes: 'Content-based /api/analyze-comprehensive needs no GitHub URL. NOTE: ports.ts and seed.ts still point cwd/download_path at agents/Codegang, which does not exist — the real checkout is 05_Apps/Codegang.',
  },
  {
    slug: 'codenexus',
    name: 'CodeNexus',
    role: 'Deterministic deep-audit lenses (source review, business-logic integrity, source-to-sink, risk)',
    basis: 'deterministic',
    kind: 'agent',
    location: 'Draymond-Orchestrator/agents/CodeNexus-main',
    env: 'CODENEXUS_URL',
    port: 3205,
    endpoint: '/health',
    invocation: 'http_api',
    notes: 'Deep-audit lenses also run credential-free via scripts/local-codenexus.ts in the benchmark loop.',
  },
  {
    slug: 'claw-protect',
    name: 'Claw-Protect',
    role: 'Secrets scanning and prompt-injection defense',
    basis: 'deterministic',
    kind: 'agent',
    location: 'Draymond-Orchestrator/agents/Claw-Protect-main',
    env: 'CLAW_PROTECT_URL',
    port: 3300,
    endpoint: '/api/health',
    invocation: 'http_api',
    notes: 'Narrow scanner: secrets + prompt injection. Not a general SCA scanner.',
  },
  {
    slug: 'depscan',
    name: 'OWASP dep-scan',
    role: 'Dependency / SCA scanning (CVE + license risk)',
    basis: 'deterministic',
    kind: 'agent',
    location: '04_Integrations/integrations/dep-scan',
    env: 'DEPScan_URL',
    port: 3301,
    endpoint: '/health',
    invocation: 'cli_command',
    notes: 'Vendored integration — do not refactor internals.',
  },
  {
    slug: 'nuclei-scanner',
    name: 'Nuclei Scanner',
    role: 'External vulnerability-surface scanning (template engine)',
    basis: 'deterministic',
    kind: 'agent',
    location: '04_Integrations/integrations/nuclei',
    env: 'NUCLEI_URL',
    port: 3302,
    endpoint: '/health',
    invocation: 'cli_command',
    notes: 'Vendored integration — do not refactor internals.',
  },
  {
    slug: 'the-deep',
    name: 'The Deep',
    role: 'Static analysis (ESLint + tsc), 20-bug taxonomy, deep-intent pass',
    basis: 'deterministic',
    kind: 'tool',
    location: 'The Deep',
    env: 'DEEP_URL',
    port: 3100,
    endpoint: '/health',
    invocation: 'http_api',
    notes: 'Two passes are deterministic; the deep-intent pass is AI-capable (Gemini when key configured). Registered as an entity by this audit team.',
  },
  {
    slug: 'deterministic-brain',
    name: 'Deterministic Brain',
    role: 'Zero-LLM control/audit loop (Parse → Reason → Execute → Audit)',
    basis: 'deterministic',
    kind: 'tool',
    location: 'Draymond-Orchestrator/agents/deterministic-brain',
    env: 'BRAIN_URL',
    port: 3210,
    endpoint: '/brain/status',
    invocation: 'http_api',
    notes: 'LLM-free reproducible control. Degrades to templates for free-form prose, by design.',
  },
  {
    slug: 'grader',
    name: 'Grader',
    role: 'Repo grading — ISO 5055 compliance, valuation, deep analysis',
    basis: 'ai',
    kind: 'tool',
    location: 'Draymond-Orchestrator/agents/Grader-main',
    env: 'GRADER_URL',
    port: 3201,
    endpoint: '/api/health',
    invocation: 'http_api',
    notes: 'Scores are AI model output, not independent measurements. Must be labeled as such in deliverables.',
  },
  {
    slug: 'reporank',
    name: 'RepoRank',
    role: 'Repo quality scoring, remediation plans, drift and quality gates',
    basis: 'ai',
    kind: 'tool',
    location: 'Draymond-Orchestrator/agents/reporank',
    env: 'REPORANK_URL',
    port: 3200,
    endpoint: '/api/health',
    invocation: 'http_api',
    notes: 'Scores are AI output reweighted by deterministic checks. Async scan + poll. Must be labeled as AI-generated.',
  },
  {
    slug: 'vibe-reality',
    name: 'Vibe-Reality',
    role: 'Reality-check repo auditor (realityScore, hallucination detection, gap analysis)',
    basis: 'ai',
    kind: 'tool',
    location: 'Draymond-Orchestrator/agents/Vibe-Reality-main',
    env: 'VIBE_REALITY_URL',
    port: 3202,
    endpoint: '/api/health',
    invocation: 'http_api',
    notes: 'Gemini-backed; /api/analyze requires a Firebase idToken unless VIBE_REALITY_LOCAL=1 for loopback fleet scoring. Registered as an entity by this audit team.',
  },
  {
    slug: 'benchmark-olympics',
    name: 'Benchmark Olympics',
    role: 'Measured fleet benchmarking + discovery loop (probe, mature hypotheses, surface weak components)',
    basis: 'measured',
    kind: 'service',
    location: 'Benchmark Olympics',
    env: 'BENCHMARK_OLYMPICS_ROOT',
    port: null,
    endpoint: null,
    invocation: 'subprocess',
    notes: 'Spawns discovery-loop-run.ts via scripts/discovery-loop-run.ts. Real measurements only; hypotheses are not scores. Registered as an entity by this audit team.',
  },
  {
    slug: 'audit-chain',
    name: 'Audit Chain',
    role: 'Audit orchestration — runs every configured auditor, merges into one canonical statement, seals with trust-layer',
    basis: 'orchestration',
    kind: 'pipeline',
    location: 'packages/audit-chain',
    invocation: 'cli_command',
    notes: 'Refuses to seal an audit with zero included auditors. Excluded auditors appear with honest reasons. Registered as an entity by this audit team.',
  },
];

/** Slugs of every audit-team member. */
export function auditTeamSlugs(): string[] {
  return AUDIT_TEAM.map((m) => m.slug);
}

/** True when a slug belongs to the audit team. */
export function isAuditTeamMember(slug: string): boolean {
  return AUDIT_TEAM.some((m) => m.slug === slug);
}

/** Members grouped by the provenance of their numbers. */
export function auditTeamByBasis(): Record<AuditBasis, AuditTeamMember[]> {
  const out: Record<AuditBasis, AuditTeamMember[]> = {
    deterministic: [],
    ai: [],
    measured: [],
    orchestration: [],
  };
  for (const m of AUDIT_TEAM) out[m.basis].push(m);
  return out;
}

/** Concise summary for chat / reports / chain context. */
export function auditTeamSummary(): string {
  const by = auditTeamByBasis();
  return (
    `Audit team (${AUDIT_TEAM.length}): ` +
    `deterministic [${by.deterministic.map((m) => m.slug).join(', ')}] | ` +
    `AI [${by.ai.map((m) => m.slug).join(', ')}] | ` +
    `measured [${by.measured.map((m) => m.slug).join(', ')}] | ` +
    `orchestration [${by.orchestration.map((m) => m.slug).join(', ')}]`
  );
}
