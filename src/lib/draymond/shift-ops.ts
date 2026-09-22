// ============================================================================
// DRAYMOND SHIFT-OPS CONTRACT — Repair/Ops sector + finance wiring (Agent D)
// ============================================================================
// Pure data contract for the 2026-09-22 fleet shift plan §6 (Repair/Ops &
// Finance). NO logic, NO side effects, NO env reads at load. Documents:
//   - the Axiom/OpenHub operating sector and the repair trigger chain
//   - the kill-switches that must stay OFF (manual cluster mode is deliberate)
//   - the money path from checkout → settled ledger → ERPNext adapter :4100
// The main orchestrator integration consumes this module; other agents' code
// must not edit it without a handoff note.
// ============================================================================

export type KillSwitchName =
  | 'DRAYMOND_AUTOSTART_SERVICES'
  | 'DRAYMOND_SECTOR_LIFECYCLE'
  | 'DRAYMOND_FAILOVER_MATRIX'
  | 'DRAYMOND_REPAIR_BENCHMARK_ENABLED';

export interface KillSwitch {
  env: KillSwitchName;
  /** Locked value — manual cluster mode is deliberate. Do NOT change. */
  value: '0';
  reason: string;
}

export const OPS_SECTOR_KILL_SWITCHES: KillSwitch[] = [
  {
    env: 'DRAYMOND_AUTOSTART_SERVICES',
    value: '0',
    reason: 'Seed jobs only — never auto-start services (bootstrap.ts).',
  },
  {
    env: 'DRAYMOND_SECTOR_LIFECYCLE',
    value: '0',
    reason: 'Automatic idle sector sweep stays off (sector-lifecycle.ts).',
  },
  {
    env: 'DRAYMOND_FAILOVER_MATRIX',
    value: '0',
    reason: 'Failover config applies only at "1" — review-first (upgrade-queue.ts). Plan §6a: re-enable ONLY as shadow, never enforce, without operator sign-off.',
  },
  {
    env: 'DRAYMOND_REPAIR_BENCHMARK_ENABLED',
    value: '0',
    reason: 'Benchmark auto-fix is proposal-only, handed to the crew lead (repair-team.ts).',
  },
];

export interface RepairChainStage {
  order: number;
  stage: string;
  detail: string;
}

export const OPS_REPAIR_CHAIN: RepairChainStage[] = [
  {
    order: 1,
    stage: 'job failure',
    detail: 'A scheduled job/chain fails; detected by the scheduler + repair-team sweep.',
  },
  {
    order: 2,
    stage: 'classify',
    detail: 'classifyFailure() buckets the error (code_error | service_down | missing_env | ...).',
  },
  {
    order: 3,
    stage: 'cooldown',
    detail: 'Per-job repair cooldown stops identical failures burning tokens (workflow-budget).',
  },
  {
    order: 4,
    stage: 'Axiom project loop',
    detail: 'axiomProjectRepair → POST /api/recourse/bridge/repair (real edits + tests + rollback).',
  },
  {
    order: 5,
    stage: 'codegen',
    detail: 'opencode-client → AXIOM_URL /v1/chat/completions; uplift-agent executes the deterministic plan.',
  },
  {
    order: 6,
    stage: 'S9 verify gate',
    detail: 'repair-gate.ts — "fixed" only opens a window; N consecutive health pings close it.',
  },
];

export interface OpsServiceContract {
  slug: string;
  name: string;
  port: number;
  url: string;
  role: string;
  managedBy: string;
}

export interface OpsSectorContract {
  name: string;
  role: string;
  services: OpsServiceContract[];
  repairFlow: string;
  repairChain: RepairChainStage[];
  killSwitches: KillSwitch[];
  notes: string[];
}

export const OPS_SECTOR_CONTRACT: OpsSectorContract = {
  name: 'Axiom/OpenHub operating sector',
  role: 'Repair & operate: single codegen execution engine (Axiom) plus the operator console (OpenHub).',
  services: [
    {
      slug: 'axiom',
      name: 'Axiom',
      port: 3198,
      url: 'http://127.0.0.1:3198',
      role: 'Codegen engine + Recourse bridge — executes the repair project loop and stack verification.',
      managedBy: 'pm2-managed (fleet ecosystem).',
    },
    {
      slug: 'openhub',
      name: 'OpenHub',
      port: 3010,
      url: 'http://127.0.0.1:3010',
      role: 'Operator console — proxies /api/axiom/*, /api/recourse/*, /api/ops/stack-verify.',
      managedBy:
        'Agent A owns the pm2 entry — Agent D did NOT add it. OPENHUB .env pins PORT=3010; the server default is 3000 if PORT is unset.',
    },
  ],
  repairFlow: 'job failure → classify → cooldown → Axiom project loop → codegen → S9 verify gate',
  repairChain: OPS_REPAIR_CHAIN,
  killSwitches: OPS_SECTOR_KILL_SWITCHES,
  notes: [
    'Kill-switches stay OFF — manual cluster mode is deliberate: no autostart, no sector lifecycle, no failover matrix, no benchmark auto-fix.',
    'Do NOT add an openhub pm2 entry from this workstream (Agent A owns it).',
    'Do NOT edit fleet-manifest.js (Agent A).',
  ],
};

export interface FinanceAdapterContract {
  name: string;
  port: number;
  url: string;
  ingestPath: string;
  method: string;
  payload: string[];
  auth: string;
  idempotencyKeyRule: string;
  failSoft: boolean;
  postingModule: string;
}

export interface FinanceWiring {
  flow: string[];
  adapter: FinanceAdapterContract;
  settledOnly: boolean;
  staleServices: Array<{ name: string; port: number; note: string }>;
  notes: string[];
}

export const FINANCE_WIRING: FinanceWiring = {
  flow: [
    'checkout (customer pays)',
    'Stripe webhook (app/api/business/stripe-webhook)',
    'treasury-state.ts ledger (settled revenue; same store as the treasury_pulse pull)',
    'business-pipeline stages (lead → … → paid)',
    'paid',
  ],
  adapter: {
    name: 'ERPNext-Ledger finance-connect adapter (02_Pillars/Overlay Finance/ERPNext-Ledger/adapter)',
    port: 4100,
    url: 'http://127.0.0.1:4100',
    ingestPath: '/api/v1/ledger/ingest',
    method: 'POST',
    payload: ['kind', 'id', 'amount_cents', 'occurred_at?', 'memo?'],
    auth: 'Bearer FINANCE_CONNECT_TOKEN',
    idempotencyKeyRule: '${kind}:${id}',
    failSoft: true,
    postingModule: 'src/lib/draymond/ledger-sync.ts → postLedgerEvent (never throws; inert until FINANCE_CONNECT_URL is set)',
  },
  settledOnly: true,
  staleServices: [
    {
      name: 'finance-connect (04_Integrations/integrations/finance-connect)',
      port: 4000,
      note: 'Different, older service — Draymond must NOT post ledger events to it. The live target is 4100.',
    },
  ],
  notes: [
    'Affiliates/commissions accrue on settled revenue only (recordAttribution → commission.accrued).',
    'Payouts are external; Draymond records payout.paid but does not move funds.',
    'Governance gate stays DRAYMOND_GOVERNANCE_GATE=enforce; PUBLISH_DRY_RUN=1 stays.',
  ],
};

/** `${kind}:${id}` — the ledger adapter's idempotency key. */
export function idempotencyKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export interface ShiftWindow {
  name: string;
  start: string;
  end: string;
  rule: string;
}

export const NIGHT_RESEARCH_WINDOW: ShiftWindow = {
  name: 'night research shift (oncology)',
  start: '22:00',
  end: '06:00',
  rule:
    'One heavy shift worker at a time. Marketing content work stays OUTSIDE this window. Verified 2026-09-22 (Agent D): all marketing jobs in business-chains.ts sit outside it — Daily Marketing Run 10:00, Full Content Creation 14:00 (Mon/Wed/Fri), Editorial Morning Push 07:00.',
};