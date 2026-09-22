// ============================================================================
// ONCOLOGY SHIFT — 22:00–06:00 night duty contract (Agent B, 2026-09-22).
// ============================================================================
// Pure contract module for the `oncology-shift` chain. It defines WHAT the
// shift must call up, run, and tear down in order — it does NOT execute
// anything and does NOT edit delegation.ts / chains.ts. The integrator imports
// the named exports here and folds them into the orchestration layer.
//
// Truth anchors (from the locked plan `plans/2026-09-22-fleet-shift-plan.md`,
// section 4, and live ports in recourse's bridge libs):
//   - overlay-oncology (:3070, pm2 "overlay-oncology") — the research workbench
//   - sidecars: UMOE (:8723), Overlay-Chemlab (:8096), OncoForesight (:8095),
//     BioSim (:8503, python sidecar in recourse/python/biosim_service),
//     KG sidecar (:8500, recourse/python/kg_service)
//   - FieldBridge = batch artifact reader (recourse /api/recourse/fieldbridge),
//     no live HTTP port
//   - Publish gate: PUBLISH_APPROVAL_KEY — fail-closed (see section 10 handoff
//     B→D: oncology publish approval key usage).
// ============================================================================

import type { DelegationSpec } from './delegation';

/** Oncology-shift slug specs — same shape as delegation.ts DelegationSpec
 *  entries (night phase, one heavy worker at a time). */
export const ONCOLOGY_SHIFT_SLUGS: DelegationSpec[] = [
  {
    slug: 'oncology_research',
    label: 'Oncology night research (Overlay Oncology workbench)',
    phase: 'night',
    timeBudgetMs: 600_000,
    tokenBudgetPerRun: 48_000,
    tokenBudgetPerDay: 96_000,
    tier: 'flash',
    priority: 2,
    duty: 'night',
  },
  {
    slug: 'fieldbridge_matrix',
    label: 'FieldBridge batch matrix (trend/connection artifact)',
    phase: 'night',
    timeBudgetMs: 300_000,
    tokenBudgetPerRun: 24_000,
    tokenBudgetPerDay: 24_000,
    tier: 'free',
    priority: 2,
    duty: 'night',
  },
  {
    slug: 'oncology_publish',
    label: 'Oncology publish to Global Lens (approval-gated)',
    phase: 'night',
    timeBudgetMs: 300_000,
    tokenBudgetPerRun: 32_000,
    tokenBudgetPerDay: 32_000,
    tier: 'flash',
    priority: 2,
    duty: 'night',
  },
];

export interface OncologyShiftStep {
  /** Local time "HH:MM" when the step is scheduled. */
  time: string;
  id: string;
  label: string;
  action: 'boot' | 'probe' | 'research' | 'batch' | 'report' | 'publish' | 'teardown';
  /** pm2/service name when this step targets a managed process. */
  service?: string;
  /** Port the service is expected to answer on. */
  port?: number;
  /** Recourse HTTP endpoint the step drives (for report/publish/batch reads). */
  endpoint?: string;
  /** Env gate that must be satisfied before the step may act (fail-closed). */
  gate?: string;
  notes?: string;
}

/** Ordered call-up / teardown plan for the oncology night shift. */
export const ONCOLOGY_SHIFT_SEQUENCE: OncologyShiftStep[] = [
  {
    time: '22:00',
    id: 'oncology-boot',
    label: 'overlay-oncology boots',
    action: 'boot',
    service: 'overlay-oncology',
    port: 3070,
    notes: 'research workbench comes up; chain start',
  },
  {
    time: '22:05',
    id: 'umoe-call-up',
    label: 'UMOE call-up + health probe',
    action: 'probe',
    service: 'umoe',
    port: 8723,
    notes: 'sidecars start ONE AT A TIME, each health-probed before the next boots',
  },
  {
    time: '22:10',
    id: 'chemlab-call-up',
    label: 'Overlay-Chemlab call-up + health probe',
    action: 'probe',
    service: 'chemlab',
    port: 8096,
  },
  {
    time: '22:15',
    id: 'oncoforesight-call-up',
    label: 'OncoForesight call-up + health probe',
    action: 'probe',
    service: 'oncoforesight',
    port: 8095,
  },
  {
    time: '22:20',
    id: 'biosim-call-up',
    label: 'BioSim sidecar call-up + health probe',
    action: 'probe',
    service: 'biosim',
    port: 8503,
    notes: 'python sidecar under recourse/python/biosim_service (uvicorn)',
  },
  {
    time: '22:25',
    id: 'kg-call-up',
    label: 'Knowledge-graph sidecar call-up + health probe',
    action: 'probe',
    service: 'kg',
    port: 8500,
    notes: 'python sidecar under recourse/python/kg_service (uvicorn, networkx)',
  },
  {
    time: '22:30',
    id: 'research-window',
    label: 'Oncology research through recourse oncology router',
    action: 'research',
    endpoint: '/api/recourse/oncology',
    notes: 'runs until 04:00; heavy work one worker at a time',
  },
  {
    time: '04:00',
    id: 'fieldbridge-batch',
    label: 'FieldBridge batch matrix on oncology outputs',
    action: 'batch',
    endpoint: '/api/recourse/fieldbridge',
    notes: 'reads the batch artifact (matrix CLI output -> SQLite + public/ JSON); no live HTTP port',
  },
  {
    time: '05:00',
    id: 'unified-report',
    label: 'Recourse composes unified oncology report',
    action: 'report',
    endpoint: '/api/recourse/oncology/research/unified',
  },
  {
    time: '05:30',
    id: 'global-lens-publish',
    label: 'Publish unified report to Global Lens',
    action: 'publish',
    endpoint: '/api/recourse/oncology/research/unified',
    gate: 'PUBLISH_APPROVAL_KEY',
    notes: 'approval gate is fail-closed: no key, no publish',
  },
  {
    time: '06:00',
    id: 'shift-teardown',
    label: 'Teardown: close sidecars, oncology down',
    action: 'teardown',
    notes: 'chain end; shift-scoped services stop in reverse call-up order',
  },
];

/** Shift window meta — the whole chain runs inside 22:00–06:00 local. */
export const ONCOLOGY_SHIFT_WINDOW = { start: '22:00', end: '06:00' } as const;

/** Sidecar port map the call-up/teardown prober keys off (service -> port). */
export const ONCOLOGY_SHIFT_PORTS: Record<string, number> = {
  umoe: 8723,
  chemlab: 8096,
  oncoforesight: 8095,
  biosim: 8503,
  kg: 8500,
};