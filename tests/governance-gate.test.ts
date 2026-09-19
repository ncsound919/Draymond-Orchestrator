import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import {
  checkGovernance,
  interpretGateOutput,
  isGovernedAction,
  resolveGovernanceMode,
  resolveGovernanceScope,
  type GovernanceAction,
} from '@/lib/draymond/governance/gate';

const STUB = path.resolve(__dirname, 'fixtures', 'stub-gate.cjs');
const python = process.execPath; // run the stub with node

const action: GovernanceAction = {
  action_type: 'send_outreach_email',
  subject: 'lead_001',
  agent: 'sales_navigator',
  params: { copy: 'hello' },
};

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('resolveGovernanceMode', () => {
  it('defaults to off', () => {
    expect(resolveGovernanceMode(undefined)).toBe('off');
    expect(resolveGovernanceMode('')).toBe('off');
  });

  it('accepts enforce and shadow case-insensitively', () => {
    expect(resolveGovernanceMode('ENFORCE')).toBe('enforce');
    expect(resolveGovernanceMode(' shadow ')).toBe('shadow');
  });

  it('falls back to off for unknown values', () => {
    expect(resolveGovernanceMode('yes-please')).toBe('off');
  });
});

describe('governance scope', () => {
  it('default scope gates policy actions but not chain steps', () => {
    const scope = resolveGovernanceScope('');
    expect(isGovernedAction('send_outreach_email', scope)).toBe(true);
    expect(isGovernedAction('adjust_ad_spend', scope)).toBe(true);
    expect(isGovernedAction('chain_step:run', scope)).toBe(false);
    expect(isGovernedAction('list_agents', scope)).toBe(false);
  });

  it('supports an explicit comma-separated override', () => {
    expect([...resolveGovernanceScope(' a , b:c ')]).toEqual(['a', 'b:c']);
  });

  it('star gates everything', () => {
    expect(isGovernedAction('anything', resolveGovernanceScope('*'))).toBe(true);
  });

  it('out-of-scope actions are never evaluated (enforce cannot freeze them)', async () => {
    process.env.STUB_GATE_OUTPUT = JSON.stringify({ verdict: 'reject', reason: 'should not run' });
    const r = await checkGovernance(
      { action_type: 'chain_step:run', subject: 'dev-brain', agent: 'chain', params: {} },
      { mode: 'enforce', script: STUB, python }
    );
    expect(r.evaluated).toBe(false);
    expect(r.verdict).toBe('allow');
    expect(r.blocked).toBe(false);
    expect(r.reason).toBe('out of governance scope');
  });

  it('in-scope actions are evaluated under enforce', async () => {
    process.env.STUB_GATE_OUTPUT = JSON.stringify({ verdict: 'reject', reason: 'capped' });
    const r = await checkGovernance(action, { mode: 'enforce', script: STUB, python });
    expect(r.evaluated).toBe(true);
    expect(r.blocked).toBe(true);
  });
});

describe('interpretGateOutput', () => {
  it('allow passes in every mode', () => {
    for (const mode of ['shadow', 'enforce'] as const) {
      const r = interpretGateOutput(mode, { verdict: 'allow', reason: 'ok' });
      expect(r.verdict).toBe('allow');
      expect(r.blocked).toBe(false);
      expect(r.needs_review).toBe(false);
    }
  });

  it('reject blocks only in enforce mode', () => {
    const enforce = interpretGateOutput('enforce', { verdict: 'reject' });
    expect(enforce.blocked).toBe(true);
    expect(enforce.needs_review).toBe(false);

    const shadow = interpretGateOutput('shadow', { verdict: 'reject' });
    expect(shadow.blocked).toBe(false);
    expect(shadow.verdict).toBe('reject');
    expect(shadow.evaluated).toBe(true);
  });

  it('needs_review queues only in enforce mode', () => {
    expect(interpretGateOutput('enforce', { verdict: 'needs_review' }).needs_review).toBe(true);
    expect(interpretGateOutput('shadow', { verdict: 'needs_review' }).needs_review).toBe(false);
  });

  it('treats an unknown verdict as needs_review', () => {
    expect(interpretGateOutput('enforce', { verdict: 'wat' }).verdict).toBe('needs_review');
  });

  it('coerces constraints/risk defensively', () => {
    const r = interpretGateOutput('enforce', {
      verdict: 'allow',
      constraints_checked: ['daily_send_cap', 42, 'max_spend_delta'],
      risk_class: 'medium',
    });
    expect(r.constraints_checked).toEqual(['daily_send_cap', 'max_spend_delta']);
    expect(r.risk_class).toBe('medium');
  });
});

describe('checkGovernance', () => {
  it('does not spawn the gate when off', async () => {
    const r = await checkGovernance(action, { mode: 'off', script: 'does-not-exist' });
    expect(r.evaluated).toBe(false);
    expect(r.verdict).toBe('allow');
    expect(r.blocked).toBe(false);
  });

  it('evaluates in shadow mode but never blocks', async () => {
    process.env.STUB_GATE_OUTPUT = JSON.stringify({
      verdict: 'reject',
      reason: "forbidden claim term: 'guaranteed'",
      constraints_checked: ['forbidden_claim_terms'],
    });
    const r = await checkGovernance(action, { mode: 'shadow', script: STUB, python });
    expect(r.evaluated).toBe(true);
    expect(r.verdict).toBe('reject');
    expect(r.blocked).toBe(false);
  });

  it('blocks on reject in enforce mode', async () => {
    process.env.STUB_GATE_OUTPUT = JSON.stringify({ verdict: 'reject', reason: 'nope' });
    const r = await checkGovernance(action, { mode: 'enforce', script: STUB, python });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('nope');
  });

  it('queues on needs_review in enforce mode', async () => {
    process.env.STUB_GATE_OUTPUT = JSON.stringify({ verdict: 'needs_review', reason: 'unknown' });
    const r = await checkGovernance(action, { mode: 'enforce', script: STUB, python });
    expect(r.needs_review).toBe(true);
    expect(r.blocked).toBe(false);
  });

  it('fails closed when the gate exits non-zero (enforce)', async () => {
    process.env.STUB_GATE_MODE = 'exit';
    const r = await checkGovernance(action, { mode: 'enforce', script: STUB, python });
    expect(r.evaluated).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.error).toContain('exited 3');
  });

  it('does not block when the gate exits non-zero (shadow)', async () => {
    process.env.STUB_GATE_MODE = 'exit';
    const r = await checkGovernance(action, { mode: 'shadow', script: STUB, python });
    expect(r.evaluated).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('fails closed on non-JSON output (enforce)', async () => {
    process.env.STUB_GATE_MODE = 'garbage';
    const r = await checkGovernance(action, { mode: 'enforce', script: STUB, python });
    expect(r.blocked).toBe(true);
    expect(r.error).toContain('non-JSON');
  });
});
