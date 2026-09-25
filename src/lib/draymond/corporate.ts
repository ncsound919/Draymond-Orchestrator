// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Corporate Operating Structure
// ============================================================================
// The org-chart layer over the delegation plan. Defines the C-suite offices,
// the revenue divisions (weighted by engine target), the overhead pools (ops /
// R&D), and the deterministic allocation math that converts the fleet daily
// token budget into per-sector daily caps.
//
// Pure + dependency-free: this module never imports delegation.ts, so the
// sector allocation can be reasoned about and tested in isolation. The
// consumption-side aggregation lives in delegation.ts (which owns consumption
// state) and imports THIS module for the sector map + caps.
//
// Non-negotiables honored: deterministic math (no LLM), auditable (every cap
// derives from the revenue targets), honest (revenue weighting reflects the
// $33k/month mission, not a fabricated balance sheet).
// ============================================================================

export type SectorId =
  | 'e1-platform'
  | 'e2-b2b'
  | 'e3-tooling'
  | 'e4-vertical'
  | 'ops'
  | 'rd';

export type SectorPool = 'revenue' | 'ops' | 'rd';

export type OfficeId = 'ceo' | 'cfo' | 'coo' | 'cto' | 'cmo' | 'ciso';

// ============================================================================
// C-SUITE
// ============================================================================

export interface OfficeDef {
  id: OfficeId;
  title: string;
  agentSlugs: string[];
  owns: SectorId[];
}

export const OFFICES: OfficeDef[] = [
  {
    id: 'ceo',
    title: 'CEO / Chief Strategy Officer',
    agentSlugs: ['draymond', 'overlay-strategist', 'kairos_scan', 'strategy_team'],
    owns: ['e4-vertical'],
  },
  {
    id: 'cfo',
    title: 'CFO / Treasurer',
    agentSlugs: ['overlay-treasurer', 'treasury_pulse', 'ghostfolio-engine', 'trading-agents'],
    owns: ['e1-platform'],
  },
  {
    id: 'coo',
    title: 'COO / Operations',
    agentSlugs: ['day-orchestrator', 'mission_pipeline_sync', 'mission_run_maas_cycle', 'aetherdesk'],
    owns: ['e2-b2b', 'ops'],
  },
  {
    id: 'cto',
    title: 'CTO / Engineering',
    agentSlugs: ['coding-stack', 'repair-team', 'benchmark_roster', 'code_review_check'],
    owns: ['e3-tooling', 'rd'],
  },
  {
    id: 'cmo',
    title: 'CMO / Growth',
    agentSlugs: ['observer', 'marketing-pulse', 'oss_marketing_stack', 'dispatch_worker_tasks'],
    owns: [],
  },
  {
    id: 'ciso',
    title: 'CISO / AI-Safety',
    agentSlugs: ['overlay-guardian', 'overlay-auditor', 'claw-protect', 'depscan', 'nuclei-scanner'],
    owns: [],
  },
];

export function officeFor(sector: SectorId): OfficeDef {
  return OFFICES.find((o) => o.owns.includes(sector)) ?? OFFICES[0]!;
}

// ============================================================================
// SECTORS
// ============================================================================

export interface SectorDef {
  id: SectorId;
  name: string;
  division: string;
  engine: 'E1' | 'E2' | 'E3' | 'E4' | null;
  /** Monthly USD revenue target from the mission (E1-E4 only). */
  revenueTargetMonthly: number;
  pool: SectorPool;
  kpis: string[];
}

export const SECTORS: SectorDef[] = [
  {
    id: 'e1-platform',
    name: 'Platform Tiers',
    division: 'Consumer Platform',
    engine: 'E1',
    revenueTargetMonthly: 10_000,
    pool: 'revenue',
    kpis: ['paid tier signups', 'platform QA pass %'],
  },
  {
    id: 'e2-b2b',
    name: 'B2B Services',
    division: 'Services',
    engine: 'E2',
    revenueTargetMonthly: 12_000,
    pool: 'revenue',
    kpis: ['qualified leads/wk', 'MaaS client deliveries', 'Aetherdesk call handling'],
  },
  {
    id: 'e3-tooling',
    name: 'Tooling & Audits',
    division: 'Developer Platform',
    engine: 'E3',
    revenueTargetMonthly: 6_000,
    pool: 'revenue',
    kpis: ['audits delivered', 'repos scored', 'remediation progress'],
  },
  {
    id: 'e4-vertical',
    name: 'Vertical Products',
    division: 'Verticals',
    engine: 'E4',
    revenueTargetMonthly: 5_000,
    pool: 'revenue',
    kpis: ['papers/items published', 'sports bankroll P&L', 'music rights tracked'],
  },
  {
    id: 'ops',
    name: 'Corporate Ops',
    division: 'Overhead',
    engine: null,
    revenueTargetMonthly: 0,
    pool: 'ops',
    kpis: ['job success rate', 'uptime', 'repair rate', 'memory health'],
  },
  {
    id: 'rd',
    name: 'Research & Development',
    division: 'Overhead',
    engine: null,
    revenueTargetMonthly: 0,
    pool: 'rd',
    kpis: ['hypotheses matured', 'breakthroughs graded', 'lessons distilled'],
  },
];

export const REVENUE_SECTOR_IDS: SectorId[] = ['e1-platform', 'e2-b2b', 'e3-tooling', 'e4-vertical'];

export function sectorById(id: SectorId): SectorDef {
  return SECTORS.find((s) => s.id === id) ?? SECTORS[SECTORS.length - 1]!;
}

// ============================================================================
// REVENUE-TARGET WEIGHTED ALLOCATION
// ============================================================================

/** Monthly USD targets by revenue engine. */
export const ENGINE_TARGETS: Record<'E1' | 'E2' | 'E3' | 'E4', number> = {
  E1: 10_000,
  E2: 12_000,
  E3: 6_000,
  E4: 5_000,
};

export const MONTHLY_TARGET = Object.values(ENGINE_TARGETS).reduce((a, b) => a + b, 0); // 33,000

/** Share of the fleet daily budget given to each pool. */
export const POOL_SHARE: Record<SectorPool, number> = {
  revenue: 0.7,
  ops: 0.15,
  rd: 0.15,
};

/** The R&D pool share can tighten to 0.10 once productivity data proves the loop. */
export const RD_POOL_FLOOR = 0.10;

/** Revenue engine's weight within the revenue pool (target ÷ total target). */
export function engineWeight(engine: 'E1' | 'E2' | 'E3' | 'E4'): number {
  return ENGINE_TARGETS[engine] / MONTHLY_TARGET;
}

/**
 * Deterministic daily token cap for a sector, derived from the fleet daily
 * budget and the revenue-target-weighted pool model.
 *
 *   revenue sector = fleetBudget × POOL_SHARE.revenue × (engine target / 33k)
 *   ops            = fleetBudget × POOL_SHARE.ops
 *   rd             = fleetBudget × POOL_SHARE.rd
 *
 * @param fleetBudget fleet-wide daily token budget (default 5M).
 */
export function sectorDailyCap(sector: SectorId, fleetBudget = 5_000_000): number {
  const def = sectorById(sector);
  if (def.pool === 'revenue' && def.engine) {
    return Math.round(fleetBudget * POOL_SHARE.revenue * engineWeight(def.engine));
  }
  return Math.round(fleetBudget * POOL_SHARE[def.pool]);
}

/** Every sector's daily cap as a map (for dashboards / tests). */
export function sectorCaps(fleetBudget = 5_000_000): Record<SectorId, number> {
  const out = {} as Record<SectorId, number>;
  for (const s of SECTORS) out[s.id] = sectorDailyCap(s.id, fleetBudget);
  return out;
}

/** Total of the per-sector caps — should equal fleetBudget. */
export function sectorCapsTotal(fleetBudget = 5_000_000): number {
  return Object.values(sectorCaps(fleetBudget)).reduce((a, b) => a + b, 0);
}

// ============================================================================
// SLUG → SECTOR MAPPING
// ============================================================================
// Covers every DELEGATION_PLAN spec plus known scheduler handlers. Anything
// unlisted defaults to `ops` (overhead) so unplanned work never masquerades as
// a revenue sector.

export const SLUG_SECTOR: Record<string, SectorId> = {
  // E1 — platform tiers (Health/Wealth/Justice) + treasury
  'overlay-treasurer': 'e1-platform',
  'treasury_pulse': 'e1-platform',
  'ghostfolio-engine': 'e1-platform',
  'trading-agents': 'e1-platform',
  'fetch_market_data': 'e1-platform',
  'run_overlay_qa': 'e1-platform',
  'check_all_sites': 'e1-platform',
  'finance_strategy_brief': 'e1-platform',
  'finance_goals_sync': 'e1-platform',
  'commission_payout': 'e1-platform',
  'commission_monthly_reset': 'e1-platform',

  // E2 — B2B services / marketing
  'aetherdesk': 'e2-b2b',
  'mission_pipeline_sync': 'e2-b2b',
  'mission_strategy_review': 'e2-b2b',
  'mission_run_maas_cycle': 'e2-b2b',
  'wf_mission_sync': 'e2-b2b',
  'marketing-pulse': 'e2-b2b',
  'oss_marketing_stack': 'e2-b2b',
  'dispatch_worker_tasks': 'e2-b2b',
  'publish_social_queue': 'e2-b2b',
  'evening_call_recap': 'e2-b2b',
  'partner_outreach_tick': 'e2-b2b',

  // E3 — tooling / audits / security
  'overlay-auditor': 'e3-tooling',
  'overlay-guardian': 'e3-tooling',
  'claw-protect': 'e3-tooling',
  'depscan': 'e3-tooling',
  'nuclei-scanner': 'e3-tooling',
  'code_review_check': 'e3-tooling',
  'github_awesome_scan': 'e3-tooling',
  'benchmark_roster': 'e3-tooling',
  'benchmark_entities': 'e3-tooling',
  'benchmark_sites': 'e3-tooling',
  'benchmark_crons': 'e3-tooling',
  'benchmark_chains': 'e3-tooling',
  'benchmark_deep_score': 'e3-tooling',
  'benchmark_upgrade_review': 'e3-tooling',
  'benchmark_sync_roster': 'e3-tooling',

  // E4 — vertical products
  'sports-steve': 'e4-vertical',
  'sports-betting-daily': 'e4-vertical',
  'editorial_push': 'e4-vertical',
  'nba_stats_ingest': 'e4-vertical',
  'bankroll_pulse': 'e4-vertical',
  'bookbridge': 'e4-vertical',
  'omniresearch-pro': 'e4-vertical',
  'generative-video-ai': 'e4-vertical',
  'scan_book_library': 'e4-vertical',
  'research_rotation': 'e4-vertical',
  'science_campaign_seed': 'e4-vertical',
  'oncology_revalidation': 'e4-vertical',
  'oncology_strategy_scan': 'e4-vertical',

  // Ops — fleet health + core heartbeat
  'draymond': 'ops',
  'brain_decision_cycle': 'ops',
  'agent_heartbeat_sweep': 'ops',
  'service_health_repair': 'ops',
  'self_repair_check': 'ops',
  'repair_failed_jobs': 'ops',
  'repair_shift': 'ops',
  'kairos_scan': 'ops',
  'ingest_news': 'ops',
  'litellm': 'ops',
  'deterministic-brain': 'ops',
  'phoenix': 'ops',
  'agent-browser': 'ops',
  'ufc-mcp': 'ops',
  'rotate_tokens': 'ops',
  'api_key_audit': 'ops',
  'phase_recap': 'ops',
  'fleet_duty_sync': 'ops',
  'generate_agent_avatars': 'ops',
  'file_share_check': 'ops',

  // R&D — night loops
  'rd_night': 'rd',
  'dream_cycle': 'rd',
  'ultraplan_process': 'rd',
  'self_learning_loop': 'rd',
  'systemic_consolidate': 'rd',
  'systemic_interconnect': 'rd',
  'synthesis_midday': 'rd',
  'clinvar_surveillance': 'rd',
  'wiki_sync': 'rd',
  'research_grade_loop': 'rd',
  'science_paper_refresh': 'rd',
  'science_publication_loop': 'rd',
  'benchmark_discovery_loop': 'rd',
};

export const DEFAULT_SECTOR: SectorId = 'ops';

/** Sector for a component slug; unlisted work defaults to ops overhead. */
export function sectorFor(slug: string): SectorId {
  return SLUG_SECTOR[slug] ?? DEFAULT_SECTOR;
}

/** All slugs currently mapped to a sector (for consumption aggregation). */
export function sectorMemberSlugs(sector: SectorId): string[] {
  return Object.entries(SLUG_SECTOR)
    .filter(([, s]) => s === sector)
    .map(([slug]) => slug);
}

// ============================================================================
// ORG SNAPSHOT (pure — no consumption)
// ============================================================================

export interface OrgSnapshotSector {
  id: SectorId;
  name: string;
  division: string;
  engine: string | null;
  pool: SectorPool;
  office: OfficeDef;
  dailyCap: number;
  revenueTargetMonthly: number;
  kpis: string[];
  memberSlugs: string[];
}

export function orgSnapshot(fleetBudget = 5_000_000): {
  offices: OfficeDef[];
  fleetBudget: number;
  sectors: OrgSnapshotSector[];
} {
  return {
    offices: OFFICES,
    fleetBudget,
    sectors: SECTORS.map((s) => ({
      id: s.id,
      name: s.name,
      division: s.division,
      engine: s.engine,
      pool: s.pool,
      office: officeFor(s.id),
      dailyCap: sectorDailyCap(s.id, fleetBudget),
      revenueTargetMonthly: s.revenueTargetMonthly,
      kpis: s.kpis,
      memberSlugs: sectorMemberSlugs(s.id),
    })),
  };
}