// ============================================================================
// GOVERNANCE GATE — ACE policy-kernel bridge
// ============================================================================
// Draymond is the governor; ACE is the policy kernel. Before a chain step
// invokes an entity, the proposed action is offered to ACE's ConstraintGate
// (facts + constraints -> allow / reject / needs_review). This module is the
// only seam: a stateless subprocess call to ACE/gate.py, no network, no state.
//
// Modes (env DRAYMOND_GOVERNANCE_GATE):
//   off      (default) — do not call the gate; every action proceeds.
//   shadow             — call the gate, report the verdict, never block.
//   enforce            — reject blocks the step; needs_review queues it for a
//                        human. If the gate cannot run, fail closed (block).
//
// Fail-closed in enforce mode is deliberate: an unavailable policy kernel must
// never silently become "allow everything". Off is the default so enabling
// enforcement stays an explicit operator decision.
// ============================================================================

import { spawn } from 'node:child_process';
import path from 'node:path';

export type GovernanceMode = 'off' | 'shadow' | 'enforce';
export type GateVerdict = 'allow' | 'reject' | 'needs_review';

export type GovernanceAction = {
  action_type: string;
  subject: string;
  agent: string;
  params: Record<string, unknown>;
  derived_from?: string[];
};

export type GovernanceCheck = {
  mode: GovernanceMode;
  /** True only when ACE's gate actually ran and answered. */
  evaluated: boolean;
  verdict: GateVerdict;
  reason: string;
  constraints_checked: string[];
  risk_class?: 'low' | 'medium' | 'high';
  /** Enforce-mode only: the step must stop. */
  blocked: boolean;
  /** Enforce-mode only: the step must go to the human review queue. */
  needs_review: boolean;
  error?: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Default governance scope: the action types that carry policy weight. Only
 * these are offered to ACE — everything else (arbitrary entity actions,
 * `chain_step:*`) is out of scope and proceeds untouched. This is what makes
 * `enforce` safe to enable: an unmapped action can never freeze a chain or an
 * entity call. Override with DRAYMOND_GOVERNANCE_SCOPE (comma list; `*` gates
 * every action).
 */
const DEFAULT_GOVERNED_ACTION_TYPES: string[] = [
  // ACE's own constraint domain (BoundsConstraintGate has rules for these).
  'send_outreach_email',
  'send_nurture_email',
  'send_proposal',
  'book_call',
  'publish_ad',
  'publish_landing_page',
  'publish_blog_post',
  'adjust_ad_spend',
  'set_pricing',
  'sign_contract_terms',
  'make_legal_claim',
  // AetherDesk high/critical writes — already human-gated upstream, so ACE
  // adding a hard reject here cannot create a new surprise approval.
  'aetherdesk:create_agent',
  'aetherdesk:update_agent',
  'aetherdesk:delete_agent',
  'aetherdesk:launch_campaign',
  'aetherdesk:start_call',
];

/** Parse the configured mode; anything unrecognised falls back to `off`. */
export function resolveGovernanceMode(
  raw: string | undefined = process.env.DRAYMOND_GOVERNANCE_GATE
): GovernanceMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === 'enforce' || value === 'shadow' || value === 'off') return value;
  return 'off';
}

/** Resolve the governed action-type set (defaults unless overridden). */
export function resolveGovernanceScope(
  raw: string | undefined = process.env.DRAYMOND_GOVERNANCE_SCOPE
): Set<string> {
  const value = (raw ?? '').trim();
  if (!value) return new Set(DEFAULT_GOVERNED_ACTION_TYPES);
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

/** True when this action type is offered to ACE (everything else passes). */
export function isGovernedAction(actionType: string, scope?: Set<string>): boolean {
  const set = scope ?? resolveGovernanceScope();
  return set.has('*') || set.has(actionType);
}

/** Absolute path to the ACE gate CLI (repo-root/ACE/gate.py by default). */
export function resolveGateScript(): string {
  return process.env.ACE_GATE_SCRIPT || path.resolve(process.cwd(), '..', 'ACE', 'gate.py');
}

function resolvePython(): string {
  return process.env.ACE_PYTHON || process.env.PYTHON_BIN || 'python';
}

/**
 * Pure mapping from a raw ACE gate result + mode to the decision Draymond acts
 * on. I/O-free so the policy mapping is unit-testable without a subprocess.
 * An unrecognised verdict is treated as `needs_review` — the gate answered,
 * but not with something we can auto-approve.
 */
export function interpretGateOutput(
  mode: GovernanceMode,
  raw: {
    verdict?: unknown;
    reason?: unknown;
    constraints_checked?: unknown;
    risk_class?: unknown;
  }
): GovernanceCheck {
  const verdict: GateVerdict =
    raw.verdict === 'reject' || raw.verdict === 'needs_review' || raw.verdict === 'allow'
      ? raw.verdict
      : 'needs_review';
  const constraints = Array.isArray(raw.constraints_checked)
    ? raw.constraints_checked.filter((c): c is string => typeof c === 'string')
    : [];
  const risk =
    raw.risk_class === 'low' || raw.risk_class === 'medium' || raw.risk_class === 'high'
      ? raw.risk_class
      : undefined;

  const enforce = mode === 'enforce';
  return {
    mode,
    evaluated: true,
    verdict,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
    constraints_checked: constraints,
    risk_class: risk,
    blocked: enforce && verdict === 'reject',
    needs_review: enforce && verdict === 'needs_review',
  };
}

/** The gate did not answer. Enforce fails closed; shadow/off keep going. */
function unavailable(mode: GovernanceMode, error: string): GovernanceCheck {
  const enforce = mode === 'enforce';
  return {
    mode,
    evaluated: false,
    verdict: enforce ? 'reject' : 'allow',
    reason: 'governance gate unavailable',
    constraints_checked: [],
    blocked: enforce,
    needs_review: false,
    error,
  };
}

/** Spawn the gate, feed it one action on stdin, collect its stdout. */
function runGate(
  python: string,
  script: string,
  input: string,
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- python/script are operator-configured paths (ACE_GATE_SCRIPT / ACE_PYTHON), not request input.
    const child = spawn(python, [script], { windowsHide: true, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`governance gate timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    if (child.stdin) {
      // A child that exits before reading stdin raises EPIPE; the exit code
      // carries the real failure, so swallow it here (see invoker.ts).
      child.stdin.on('error', () => {});
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Evaluate one proposed action against the ACE policy gate.
 *
 * Never throws: a broken gate becomes a structured `unavailable` result so the
 * caller's mode policy (fail-closed only under `enforce`) decides what happens.
 */
export async function checkGovernance(
  action: GovernanceAction,
  options?: {
    mode?: GovernanceMode;
    timeoutMs?: number;
    script?: string;
    python?: string;
    /** Override the governed action-type set (defaults to DRAYMOND_GOVERNANCE_SCOPE). */
    scope?: Set<string>;
  }
): Promise<GovernanceCheck> {
  const mode = options?.mode ?? resolveGovernanceMode();

  if (mode === 'off') {
    return {
      mode,
      evaluated: false,
      verdict: 'allow',
      reason: 'governance gate disabled (off)',
      constraints_checked: [],
      blocked: false,
      needs_review: false,
    };
  }

  if (!isGovernedAction(action.action_type, options?.scope)) {
    return {
      mode,
      evaluated: false,
      verdict: 'allow',
      reason: 'out of governance scope',
      constraints_checked: [],
      blocked: false,
      needs_review: false,
    };
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const script = options?.script ?? resolveGateScript();
  const python = options?.python ?? resolvePython();

  try {
    const { code, stdout, stderr } = await runGate(
      python,
      script,
      JSON.stringify(action),
      timeoutMs
    );
    if (code !== 0) {
      return unavailable(mode, `gate exited ${code}: ${stderr.slice(0, 300) || 'no stderr'}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return unavailable(mode, `gate returned non-JSON: ${stdout.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== 'object') {
      return unavailable(mode, 'gate returned a non-object');
    }
    return interpretGateOutput(mode, parsed as Record<string, unknown>);
  } catch (err) {
    return unavailable(mode, err instanceof Error ? err.message : String(err));
  }
}
