import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/draymond/chains', () => ({ instantiateChain: vi.fn(), executeChain: vi.fn() }));
vi.mock('../src/lib/draymond/business-pipeline', () => ({ listOpportunities: vi.fn() }));
vi.mock('../src/lib/draymond/mission-pipeline', () => ({ markDelivered: vi.fn() }));
vi.mock('../src/lib/draymond/mission-strategy', () => ({ getService: vi.fn(), readStrategy: vi.fn() }));
vi.mock('../src/lib/draymond/self-learning', () => ({ recordOutcome: vi.fn() }));

import { dispatchDelivery } from '../src/lib/draymond/mission-delivery';
import { instantiateChain, executeChain } from '../src/lib/draymond/chains';
import { listOpportunities, type Opportunity } from '../src/lib/draymond/business-pipeline';
import { markDelivered } from '../src/lib/draymond/mission-pipeline';
import { getService, readStrategy } from '../src/lib/draymond/mission-strategy';
import { recordOutcome } from '../src/lib/draymond/self-learning';

const mockInstantiateChain = vi.mocked(instantiateChain);
const mockExecuteChain = vi.mocked(executeChain);
const mockListOpportunities = vi.mocked(listOpportunities);
const mockMarkDelivered = vi.mocked(markDelivered);
const mockGetService = vi.mocked(getService);
const mockReadStrategy = vi.mocked(readStrategy);
const mockRecordOutcome = vi.mocked(recordOutcome);

const OPP: Opportunity = {
  id: 'opp_1',
  name: 'Acme Audit',
  engine: 'E3-tooling',
  stage: 'won',
  monthlyValue: 500,
  serviceId: 'audit',
  tierId: 'deep',
  owner: 'mission',
  nextAction: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SERVICE = {
  id: 'audit',
  name: 'Codebase Audit & QA',
  agents: ['grader', 'reporank', 'mutly', 'uplift-agent'],
  skills: [],
  deliveryCostCents: 800,
  targetMonthly: 1000,
  billing: 'one_time',
  tiers: [],
};

const DONE_STEPS = {
  grade: { status: 'completed', input: {}, output: {} },
  report: { status: 'completed', input: {}, output: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListOpportunities.mockResolvedValue([{ ...OPP }]);
  mockReadStrategy.mockResolvedValue({} as never);
  mockGetService.mockReturnValue(SERVICE as never);
  mockMarkDelivered.mockResolvedValue({
    invoice: { id: 'inv_1', amountCents: 25000 },
    opportunity: { id: 'opp_1', stage: 'invoiced' },
  } as never);
});

describe('mission delivery dispatch', () => {
  it('returns not-found for an unknown opportunity id', async () => {
    mockListOpportunities.mockResolvedValue([]);
    const r = await dispatchDelivery('nope');
    expect(r).toEqual({ opportunityId: 'nope', ok: false, stage: 'unknown', error: 'opportunity not found' });
    expect(mockGetService).not.toHaveBeenCalled();
    expect(mockInstantiateChain).not.toHaveBeenCalled();
  });

  it('refuses to dispatch unless the opportunity is won or delivering', async () => {
    mockListOpportunities.mockResolvedValue([{ ...OPP, stage: 'lead' }]);
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('lead');
    expect(r.error).toMatch(/must be 'won' or 'delivering' to dispatch/);
    expect(mockInstantiateChain).not.toHaveBeenCalled();
  });

  it('rejects a service that is not in the strategy', async () => {
    mockGetService.mockReturnValue(undefined);
    const r = await dispatchDelivery('opp_1');
    expect(r).toMatchObject({ ok: false, stage: 'won', error: 'service audit not in strategy' });
    expect(mockInstantiateChain).not.toHaveBeenCalled();
  });

  it('routes aetherdesk to the webhook path instead of a chain', async () => {
    mockListOpportunities.mockResolvedValue([{ ...OPP, serviceId: 'aetherdesk' }]);
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/webhook-driven/);
    expect(r.error).toMatch(/Aetherdesk/);
    expect(mockInstantiateChain).not.toHaveBeenCalled();
    expect(mockMarkDelivered).not.toHaveBeenCalled();
  });

  it('dispatches a won audit through its chain and marks it delivered', async () => {
    mockInstantiateChain.mockResolvedValue({ id: 'inst_1' } as never);
    mockExecuteChain.mockResolvedValue({
      chain_id: 'inst_1',
      input: {},
      context: {},
      steps: DONE_STEPS,
    } as never);
    const r = await dispatchDelivery('opp_1');
    expect(r).toEqual({
      opportunityId: 'opp_1',
      ok: true,
      stage: 'invoiced',
      invoice: { id: 'inv_1', amountCents: 25000 },
      chainSlug: 'audit-delivery',
      stepStatuses: { grade: 'completed', report: 'completed' },
    });
    expect(mockInstantiateChain).toHaveBeenCalledWith(
      'audit-delivery',
      expect.objectContaining({ niche: 'Acme Audit', topic: 'Acme Audit', brand_voice: 'professional' }),
      undefined,
      'mission-engine',
    );
    expect(mockExecuteChain).toHaveBeenCalledWith('inst_1', 'mission-engine');
    expect(mockMarkDelivered).toHaveBeenCalledWith('opp_1');
  });

  it('defaults the delivered stage to invoiced when the opportunity is missing', async () => {
    mockInstantiateChain.mockResolvedValue({ id: 'inst_1' } as never);
    mockExecuteChain.mockResolvedValue({ steps: DONE_STEPS } as never);
    mockMarkDelivered.mockResolvedValue({ invoice: { id: 'inv_1', amountCents: 25000 }, opportunity: null } as never);
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(true);
    expect(r.stage).toBe('invoiced');
  });

  it('reports failed steps without marking the mission delivered', async () => {
    mockInstantiateChain.mockResolvedValue({ id: 'inst_1' } as never);
    mockExecuteChain.mockResolvedValue({
      steps: { grade: { status: 'completed' }, report: { status: 'failed' } },
    } as never);
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('1 step(s) failed');
    expect(r.stepStatuses).toEqual({ grade: 'completed', report: 'failed' });
    expect(r.chainSlug).toBe('audit-delivery');
    expect(mockMarkDelivered).not.toHaveBeenCalled();
  });

  it('counts blocked and retrying steps as failures too', async () => {
    mockInstantiateChain.mockResolvedValue({ id: 'inst_1' } as never);
    mockExecuteChain.mockResolvedValue({
      steps: { a: { status: 'blocked' }, b: { status: 'retrying' }, c: { status: 'completed' } },
    } as never);
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('2 step(s) failed');
    expect(mockMarkDelivered).not.toHaveBeenCalled();
  });

  it('records an incident and returns the error when the chain throws', async () => {
    mockInstantiateChain.mockRejectedValue(new Error('chain boom'));
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('chain boom');
    expect(r.chainSlug).toBe('audit-delivery');
    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'mission-engine',
        kind: 'incident',
        success: false,
        summary: expect.stringContaining('audit-delivery'),
      }),
    );
  });

  it('still reports the failure when the incident record itself throws', async () => {
    mockInstantiateChain.mockRejectedValue(new Error('chain boom'));
    mockRecordOutcome.mockRejectedValue(new Error('learning db down'));
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('chain boom');
  });

  it('stringifies non-Error throws into the result error', async () => {
    mockInstantiateChain.mockRejectedValue('flat failure');
    const r = await dispatchDelivery('opp_1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('flat failure');
    expect(mockRecordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'flat failure', success: false }),
    );
  });
});
