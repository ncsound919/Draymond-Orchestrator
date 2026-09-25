import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  escalateTrickyDecision,
  isTrickySituation,
  severityScore,
  shouldContactOperator,
  discountWithinCap,
  DISCOUNT_CAP_PCT,
  DISCOUNT_CAP_PCT_HIGH_MARGIN,
  SEVERITY_CONTACT_THRESHOLD,
  OPERATOR_ONLY_BOUNDARIES,
  REPAIR_FALLBACK_ORDER,
  type TrickySituation,
} from '../src/lib/draymond/tricky-decision';

const SITUATION: TrickySituation = {
  problem: 'A client wants a deliverable outside the signed scope for the same price.',
  category: 'client',
  options: [
    { id: 'accept', title: 'Accept', description: 'Deliver extra scope at no charge to keep the account.' },
    { id: 'renegotiate', title: 'Renegotiate', description: 'Propose a change order with a fee before proceeding.' },
    { id: 'decline', title: 'Decline', description: 'Stay strictly in scope; offer paid add-on.' },
  ],
};

describe('tricky-decision', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes through Dev-Brain JEV decision when reachable', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          matrix: { recommendedOptionId: 'renegotiate', synthesisRationale: 'Scope change fee protects margin.', options: [{ id: 'renegotiate', recommended: true }] },
          jev: { source: 'localjev', choice: { optionId: 'renegotiate' } },
          decidedAt: new Date().toISOString(),
        }),
        { status: 200 },
      )
    );

    const result = await escalateTrickyDecision(SITUATION);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('dev-brain-jevv');
    expect(result.recommendedOptionId).toBe('renegotiate');
    expect(result.jev?.source).toBe('localjev');

    const callBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(callBody.problem).toContain('client');
    expect(callBody.candidates.map((c: { name: string }) => c.name)).toEqual(['accept', 'renegotiate', 'decline']);
  });

  it('falls back to deterministic /api/decide when JEV path is unreachable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 })); // /api/decide/jev fails
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ recommendedOptionId: 'decline', synthesisRationale: 'Stay in scope.' }), { status: 200 })
    );

    const result = await escalateTrickyDecision(SITUATION);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('dev-brain-deterministic');
    expect(result.jev).toBeNull();
    expect(result.recommendedOptionId).toBe('decline');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns honest unavailable when Dev-Brain is down', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await escalateTrickyDecision(SITUATION);
    expect(result.ok).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.decision).toBe('');
  });

  it('never fabricates a recommendation on malformed response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const result = await escalateTrickyDecision(SITUATION);
    expect(result.ok).toBe(false);
    expect(result.recommendedOptionId).toBeNull();
  });

  it('classifies tricky situations deterministically', () => {
    expect(isTrickySituation({ ...SITUATION, category: 'compliance' })).toBe(true);
    expect(isTrickySituation({ ...SITUATION, category: 'security' })).toBe(true);
    expect(isTrickySituation({ ...SITUATION, category: 'budget', options: [{ id: 'a', title: 'A', description: '' }, { id: 'b', title: 'B', description: '' }] })).toBe(false);
    expect(isTrickySituation({ ...SITUATION, options: [] })).toBe(true);
    expect(isTrickySituation({ ...SITUATION, options: [{ id: 'only', title: 'Only', description: '' }] })).toBe(true);
  });

  it('enforces the operator discount caps (Q12)', () => {
    expect(DISCOUNT_CAP_PCT).toBe(15);
    expect(DISCOUNT_CAP_PCT_HIGH_MARGIN).toBe(25);
    expect(discountWithinCap(15, false)).toBe(true);
    expect(discountWithinCap(16, false)).toBe(false);
    expect(discountWithinCap(25, true)).toBe(true);
    expect(discountWithinCap(26, true)).toBe(false);
  });

  it('locks operator-only boundaries (Q13) and the repair fallback order (Q3)', () => {
    expect(OPERATOR_ONLY_BOUNDARIES).toContain('contract_terms');
    expect(OPERATOR_ONLY_BOUNDARIES).toContain('legal_claims');
    expect(OPERATOR_ONLY_BOUNDARIES).toContain('invoices');
    expect(OPERATOR_ONLY_BOUNDARIES).toContain('pricing');
    expect(OPERATOR_ONLY_BOUNDARIES).toContain('payouts');
    expect(REPAIR_FALLBACK_ORDER).toEqual(['axiom/openhub', 'draymond', 'recourse']);
  });

  it('scores severity on the 1–10 meter and contacts operator at 8+ (Q19)', () => {
    expect(SEVERITY_CONTACT_THRESHOLD).toBe(8);
    expect(severityScore({ revenueImpact: 'none', clientFacing: false, securityFlag: false, complianceFlag: false, repeatedFailure: false, deadlineImminent: false })).toBe(1);
    expect(severityScore({ revenueImpact: 'large', clientFacing: true, securityFlag: false, complianceFlag: false, repeatedFailure: true, deadlineImminent: true })).toBe(10);
    expect(shouldContactOperator({ revenueImpact: 'large', clientFacing: true, securityFlag: true, complianceFlag: false, repeatedFailure: true, deadlineImminent: true })).toBe(true);
    expect(shouldContactOperator({ revenueImpact: 'small', clientFacing: false, securityFlag: false, complianceFlag: false, repeatedFailure: false, deadlineImminent: false })).toBe(false);
  });
});