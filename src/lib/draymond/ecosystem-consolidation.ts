// ============================================================================
// ECOSYSTEM CONSOLIDATION — single source of truth for the federated system
// ============================================================================
// One governor, not one codebase. This module declares how the previously
// standalone repos are governed by Draymond without merging their trees:
//
//   governor      = draymond          (scheduling, invocation, events, chains)
//   policy kernel = ace-governance    (constraints, escalation, truth maintenance)
//   agent runtime = hermes-runtime    (generative agent loop, consumed externally)
//
// Every other source below is a *governed* entity: it stays in its own git repo
// and is reached through the registry's invocation methods. `reality` is not
// decoration — it records what is actually functional so nothing theater-grade
// is presented as working (see AGENTS.md "Brutal Honesty").
//
// Registration is deliberate and idempotent: `consolidatedEntityInserts()`
// returns only the entities that do not already exist in the registry. The
// pre-existing `recursive-ip`, `overlay-finance`, and `aetherdesk` entities are
// referenced here but never re-upserted, so tuned configs are not clobbered.
// ============================================================================

import type { DraymondEntityInsert } from './types';

/** The single agent that governs the federated system. */
export const ECOSYSTEM_GOVERNOR = 'draymond';

/** Slug of the policy kernel every action can be gated through. */
export const POLICY_KERNEL_SLUG = 'ace-governance';

/** Slug of the agent loop used for generative work. */
export const AGENT_RUNTIME_SLUG = 'hermes-runtime';

export type ConsolidationRole = 'governor' | 'policy-kernel' | 'agent-runtime' | 'governed';

/** What a source actually is today. `theater`/`vendored` are load-bearing labels. */
export type ConsolidationReality = 'real' | 'partial' | 'theater' | 'vendored' | 'config-only';

export type ConsolidationSource = {
  id: string;
  /** Repo-root-relative path of the source. */
  path: string;
  role: ConsolidationRole;
  reality: ConsolidationReality;
  /** Slug of the entity that governs it (always the ecosystem governor today). */
  governedBy: string;
  summary: string;
  /** Registry entities this source maps to (existing or newly declared). */
  entitySlugs: string[];
  /** What still prevents this from being fully governed / trustworthy. */
  blockers: string[];
};

// ============================================================================
// THE EIGHT SOURCES
// ============================================================================

export const CONSOLIDATION_SOURCES: ConsolidationSource[] = [
  {
    id: 'aetherdesk-call-center',
    path: '04_Integrations/Aetherdesk-Call-Center',
    role: 'governed',
    reality: 'real',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Multi-tenant FastAPI AI call center (port 8002) with its own ReAct orchestrator. Already registered as the `aetherdesk` service with a typed operation catalog and approval flow in ./aetherdesk.ts.',
    entitySlugs: ['aetherdesk'],
    blockers: [
      'MCP client is a mock (src/api/services/mcp_client.py); the VibeServe proxy the UI calls does not exist yet.',
      'Has its own orchestrator — it stays subordinate: Draymond invokes AetherDesk operations, never the reverse.',
    ],
  },
  {
    id: 'oss-marketing-stack',
    path: '04_Integrations/oss-marketing-stack',
    role: 'governed',
    reality: 'real',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Seven upstream open-source marketing services as Docker Compose stacks (Shlink, Postiz+Temporal, Listmonk, Twenty, Umami, Formbricks, Windmill), controlled by ./oss-marketing.ts rather than PM2.',
    entitySlugs: ['oss-marketing-stack'],
    blockers: [
      'Six separate `-f` compose files with no umbrella; the default compose deploys only Shlink.',
      'Twenty and Formbricks require encryption/secret env before they can start.',
    ],
  },
  {
    id: 'integrations',
    path: '04_Integrations/integrations',
    role: 'governed',
    reality: 'vendored',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Tool box of mostly upstream mirrors (composio, litellm, browser-use, Scrapling, ghostfolio, nuclei, dep-scan, phoenix, zvec, etc.). INTEGRATIONS.md already maps each to an ecosystem slot; they are referenced as tools, not merged.',
    entitySlugs: ['deterministic-brain', 'marketing-tool', 'litellm', 'ghostfolio-engine', 'nuclei-scanner', 'depscan'],
    blockers: [
      'Vendored `-main` snapshots are upstream-owned and must not be refactored here.',
      'Several are registry-only (no runnable adapter yet), so Draymond can discover but not invoke them.',
    ],
  },
  {
    id: 'staffing-commission-engine',
    path: '05_Apps/Staffing-Commission-Engine',
    role: 'governed',
    reality: 'real',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'FastAPI commission engine (port 8003, PM2 app `commission-engine`): sales attribution, tiered commissions, weekly Stripe Connect payouts.',
    entitySlugs: ['staffing-commission-engine'],
    blockers: [
      'Moves money — registered high-risk; needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and a database URL.',
    ],
  },
  {
    id: 'dev-brain',
    path: 'Dev-Brain',
    role: 'governed',
    reality: 'partial',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Vite/React + Express engineering-reasoning app (port 3450). The deterministic engines (intake scoring, candidate triage) are real; the marketed "multi-agent debate/consensus" is synthetic.',
    entitySlugs: ['dev-brain'],
    blockers: [
      'Multi-agent debate/consensus is metadata templating plus a count-based agreement formula — no LLM, no debate. Outputs are heuristic.',
      'ollamaClient.ts is a facade (no network call; reports a fabricated model) and the decision matrix is hardcoded scenario templates.',
    ],
  },
  {
    id: 'ace',
    path: 'ACE',
    role: 'policy-kernel',
    reality: 'partial',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Deterministic control plane: fact provenance (TMS), rule-gated actions, constraint gates, risk-tiered approval queue. Exposes ACE/gate.py, called by Draymond before chain-step invocation.',
    entitySlugs: [POLICY_KERNEL_SLUG],
    blockers: [
      'Scaffold, not production: RuleEngine and ConstraintGate are in-memory reference implementations.',
      'Datalog (rules) and Z3 (compound constraints) seams are defined but not wired.',
    ],
  },
  {
    id: 'overlay-finance',
    path: '02_Pillars/Overlay Finance',
    role: 'governed',
    reality: 'partial',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Mixed pillar. Recursive-IP-Builder is a real FastAPI service (heuristic IP grading, stubbed-by-default NFT minting); IP-Builder-Platform is docs-only; Overlay Workforce has real configs but an empty agents/ runtime.',
    entitySlugs: ['recursive-ip', 'overlay-finance'],
    blockers: [
      'IP-Builder-Platform--main contains no application code — vision docs only.',
      'Overlay Workforce `agents/` and `skills/` are empty; its orchestration runtime is missing.',
      'IP grading is keyword statistics, not legal/patent analysis; NFT minting fabricates tx data unless web3 env is set.',
    ],
  },
  {
    id: 'hermes-agent-main',
    path: 'Draymond-Orchestrator/agents/hermes-agent-main',
    role: 'agent-runtime',
    reality: 'vendored',
    governedBy: ECOSYSTEM_GOVERNOR,
    summary:
      'Nous Research Hermes Agent (MIT, v0.20.0) — a full agent framework consumed as an external CLI/package. This tree is an untracked shallow upstream snapshot.',
    entitySlugs: [AGENT_RUNTIME_SLUG],
    blockers: [
      'Upstream-owned and fast-moving: never edit the vendored tree; extend via its plugin/skill/MCP points.',
      'Gitignored by the outer repo — any in-tree work is invisible and lost on refresh.',
      'Not yet installed as a package, so it is registered as `manual` until the operator wires the CLI/MCP endpoint.',
    ],
  },
];

// ============================================================================
// NEW GOVERNED ENTITIES (idempotent upsert; existing slugs excluded)
// ============================================================================

const commissionEngineUrl = process.env.COMMISSION_ENGINE_URL || 'http://127.0.0.1:8003';
const devBrainUrl = process.env.DEV_BRAIN_URL || 'http://127.0.0.1:3450';

export const CONSOLIDATED_ENTITIES: DraymondEntityInsert[] = [
  {
    name: 'ACE Governance Kernel',
    slug: POLICY_KERNEL_SLUG,
    kind: 'service',
    description:
      'Deterministic control-plane policy kernel: fact provenance (TMS), rule-gated actions, constraint gates, and a risk-tiered human approval queue. Exposes a stateless gate CLI (ACE/gate.py: ProposedAction JSON on stdin -> GateResult JSON on stdout) that Draymond calls before chain-step invocation.',
    version: '0.1.0',
    tags: ['governance', 'policy', 'constraints', 'escalation', 'control-plane', 'ace'],
    category: 'infrastructure',
    sector: 'community',
    invocation_method: 'subprocess',
    invocation_config: {
      command: 'python',
      args: ['../ACE/gate.py'],
      requires: ['python'],
    },
    capabilities: [
      'constraint-gate',
      'fact-provenance',
      'truth-maintenance',
      'risk-classification',
      'escalation-queue',
    ],
    source_type: 'local',
    is_integrated: true,
    risk_level_default: 'high',
    confidence_threshold_override: 0.9,
    timeout_seconds: 30,
  },
  {
    name: 'Hermes Agent Runtime',
    slug: AGENT_RUNTIME_SLUG,
    kind: 'agent',
    description:
      'Nous Research Hermes Agent (MIT, v0.20.0) — the agent loop for generative work (tool calling, subagent delegation, skills, MCP). Consumed as an external CLI/package; the vendored snapshot under Draymond-Orchestrator/agents/hermes-agent-main is upstream and never edited.',
    version: '0.20.0',
    tags: ['runtime', 'agent-loop', 'mcp', 'plugins', 'skills', 'vendored', 'external'],
    category: 'infrastructure',
    sector: 'community',
    invocation_method: 'manual',
    invocation_config: {
      install: 'pip install hermes-agent',
      upstream: 'https://github.com/NousResearch/Hermes-Agent',
    },
    capabilities: [
      'tool-calling',
      'subagent-delegation',
      'skills',
      'mcp-client',
      'mcp-server',
      'cron',
      'gateway',
    ],
    source_type: 'github',
    source_url: 'https://github.com/NousResearch/Hermes-Agent',
    is_integrated: false,
    risk_level_default: 'medium',
  },
  {
    name: 'Staffing Commission Engine',
    slug: 'staffing-commission-engine',
    kind: 'service',
    description:
      'Tracks sales attributions, calculates tier-based commissions, and disburses weekly payouts via Stripe Connect. FastAPI on port 8003 (PM2 app `commission-engine`).',
    version: '0.1.0',
    tags: ['staffing', 'commissions', 'stripe', 'payouts', 'finance'],
    category: 'finance',
    sector: 'wealth',
    invocation_method: 'http_api',
    invocation_config: {
      url: commissionEngineUrl,
      method: 'POST',
      requires_env: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'DATABASE_URL'],
    },
    capabilities: ['commission-calculation', 'sales-attribution', 'stripe-connect-payouts'],
    source_type: 'local',
    is_integrated: true,
    risk_level_default: 'high',
  },
  {
    name: 'Dev Brain',
    slug: 'dev-brain',
    kind: 'service',
    description:
      'Engineering-reasoning web app (Vite/React + Express, port 3450). Deterministic engines (intake scoring, candidate triage) are real; the advertised multi-agent debate/consensus is synthetic. Treat outputs as heuristic, not deliberation.',
    version: '1.0.0',
    tags: ['reasoning', 'engineering', 'deterministic', 'heuristic'],
    category: 'content',
    sector: 'learn',
    invocation_method: 'http_api',
    invocation_config: {
      url: devBrainUrl,
      method: 'POST',
      endpoints: {
        intake: { path: '/api/intake', method: 'POST' },
        decide: { path: '/api/decide', method: 'POST' },
        strategy_decide: { path: '/api/strategy/decide', method: 'POST' },
        repair_triage: { path: '/api/repair/triage', method: 'POST' },
      },
    },
    capabilities: ['intake-scoring', 'candidate-triage', 'decision-matrix', 'red-team'],
    source_type: 'local',
    is_integrated: true,
    risk_level_default: 'low',
  },
  {
    name: 'OSS Marketing Stack',
    slug: 'oss-marketing-stack',
    kind: 'service',
    description:
      'Umbrella entity for the Docker Compose marketing team under 04_Integrations/oss-marketing-stack (Shlink, Postiz+Temporal, Listmonk, Twenty, Umami, Formbricks, Windmill). Managed by Draymond via oss-marketing.ts (docker compose, not PM2).',
    version: '1.0.0',
    tags: ['marketing', 'docker', 'crm', 'email', 'analytics', 'social', 'umbrella'],
    category: 'marketing',
    sector: 'community',
    invocation_method: 'internal',
    invocation_config: { module_path: '@/lib/draymond/oss-marketing' },
    capabilities: [
      'link-tracking',
      'social-scheduling',
      'email-campaigns',
      'crm',
      'analytics',
      'surveys',
      'workflow',
    ],
    source_type: 'docker',
    is_integrated: true,
    risk_level_default: 'low',
  },
];

// ============================================================================
// PUBLIC HELPERS
// ============================================================================

/** Registry inserts for the consolidation (new entities only). */
export function consolidatedEntityInserts(): DraymondEntityInsert[] {
  return CONSOLIDATED_ENTITIES;
}

/** Counts by reality + how many new entities the consolidation would register. */
export function consolidationSummary(): {
  sources: number;
  newEntities: number;
  byReality: Record<ConsolidationReality, number>;
} {
  const byReality = {
    real: 0,
    partial: 0,
    theater: 0,
    vendored: 0,
    'config-only': 0,
  } as Record<ConsolidationReality, number>;
  for (const source of CONSOLIDATION_SOURCES) byReality[source.reality] += 1;
  return { sources: CONSOLIDATION_SOURCES.length, newEntities: CONSOLIDATED_ENTITIES.length, byReality };
}

/**
 * Register the consolidation's new governed entities (idempotent upsert by
 * slug). Dynamic import keeps this module free of DB/Next dependencies for
 * tests. Existing entities (recursive-ip, overlay-finance, aetherdesk, ...)
 * are intentionally not re-registered here.
 */
export async function registerConsolidatedEcosystem(): Promise<{ registered: number; errors: string[] }> {
  const { registerEntities } = await import('./registry');
  return registerEntities(CONSOLIDATED_ENTITIES);
}
