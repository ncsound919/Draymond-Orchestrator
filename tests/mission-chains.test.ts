import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/draymond/chains', () => ({ createChain: vi.fn(), addSteps: vi.fn(), getChain: vi.fn() }));
vi.mock('../src/lib/draymond/registry', () => ({ getEntity: vi.fn() }));
vi.mock('../src/lib/draymond/client', () => ({ createDraymondClient: vi.fn() }));

import { MISSION_CHAIN_DEFS, seedMissionChains } from '../src/lib/draymond/mission-chains';
import { createChain, addSteps, getChain } from '../src/lib/draymond/chains';
import { getEntity } from '../src/lib/draymond/registry';
import { createDraymondClient } from '../src/lib/draymond/client';

const mockCreateChain = vi.mocked(createChain);
const mockAddSteps = vi.mocked(addSteps);
const mockGetChain = vi.mocked(getChain);
const mockGetEntity = vi.mocked(getEntity);
const mockCreateDraymondClient = vi.mocked(createDraymondClient);

function buildSupabase() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { from, update, eq };
}

let supabaseStub: ReturnType<typeof buildSupabase>;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetChain.mockResolvedValue(null);
  mockGetEntity.mockImplementation(async (slug) => ({ id: `ent_${slug}` }) as never);
  mockCreateChain.mockImplementation(async (input) => ({ id: `chain_${input.slug}`, slug: input.slug } as never));
  mockAddSteps.mockImplementation(async (inputs) => inputs.map((i) => ({ ...i, id: `step_${i.name}` })) as never);
  supabaseStub = buildSupabase();
  mockCreateDraymondClient.mockResolvedValue(supabaseStub as never);
});

function depPatches() {
  return supabaseStub.update.mock.calls
    .map((c) => c[0])
    .filter(
      (p): p is { depends_on_steps: string[] } =>
        Boolean(p) && typeof p === 'object' && Array.isArray((p as { depends_on_steps?: unknown }).depends_on_steps),
    );
}

describe('mission chain templates', () => {
  it('defines the three delivery chains', () => {
    const slugs = MISSION_CHAIN_DEFS.map((c) => c.slug).sort();
    expect(slugs).toEqual(['audit-delivery', 'maas-monthly-cycle', 'research-brief-delivery']);
  });

  it('references only known entity slugs and valid actions', () => {
    const known = new Set([
      'grader', 'reporank', 'mutly', 'uplift-agent',
      'omni-research', 'social-media-dashboard', 'kaggle',
    ]);
    for (const chain of MISSION_CHAIN_DEFS) {
      for (const step of chain.steps) {
        expect(known.has(step.entitySlug), `${chain.slug}:${step.name} -> ${step.entitySlug}`).toBe(true);
        expect(step.action.length).toBeGreaterThan(0);
        expect(step.step_order).toBeGreaterThan(0);
      }
    }
  });

  it('orders steps so dependents have higher step_order', () => {
    for (const chain of MISSION_CHAIN_DEFS) {
      const byOrder = new Map(chain.steps.map((s) => [s.name, s.step_order]));
      for (const step of chain.steps) {
        for (const depName of step.depends_on) {
          const depOrder = byOrder.get(depName);
          expect(depOrder, `${chain.slug}: ${step.name} depends on ${depName}`).toBeLessThan(step.step_order);
        }
      }
    }
  });
});

describe('seedMissionChains', () => {
  it('seeds all three chain definitions end-to-end', async () => {
    const result = await seedMissionChains();
    expect(result.errors).toEqual([]);
    expect(result.seeded.map((s) => s.slug).sort()).toEqual([
      'audit-delivery', 'maas-monthly-cycle', 'research-brief-delivery',
    ]);
    expect(result.seeded.every((s) => s.id.startsWith('chain_'))).toBe(true);

    expect(mockGetChain).toHaveBeenCalledTimes(3);
    expect(mockCreateChain).toHaveBeenCalledTimes(3);
    for (const [input] of mockCreateChain.mock.calls) {
      expect(input).toMatchObject({
        is_template: true,
        status: 'draft',
        trigger_type: 'manual',
        version: '1.0.0',
        max_retries: 2,
      });
    }

    // entity ids resolved once per unique slug per chain (dedupe is per-chain)
    expect(mockGetEntity).toHaveBeenCalledTimes(12);

    // all 13 steps (5+4+4) are created with resolved entity ids and no deps yet
    expect(mockAddSteps).toHaveBeenCalledTimes(3);
    expect(mockAddSteps.mock.calls.map((c) => c[0].length)).toEqual([5, 4, 4]);
    const stepInputs = mockAddSteps.mock.calls.flatMap((c) => c[0]);
    expect(stepInputs.every((s) => String(s.entity_id).startsWith('ent_'))).toBe(true);
    expect(stepInputs.every((s) => Array.isArray(s.depends_on_steps) && s.depends_on_steps.length === 0)).toBe(true);

    // steps named with "QA" get medium risk, everything else low
    const qa = stepInputs.filter((s) => s.name.includes('QA'));
    expect(qa).toHaveLength(2);
    expect(qa.every((s) => s.risk_level === 'medium')).toBe(true);
    expect(stepInputs.filter((s) => !s.name.includes('QA')).every((s) => s.risk_level === 'low')).toBe(true);

    // dependency patches remap step names to created ids
    const patches = depPatches();
    expect(patches).toHaveLength(13);
    expect(patches.every((p) => p.depends_on_steps.every((id) => String(id).startsWith('step_')))).toBe(true);
    expect(patches).toContainEqual({ depends_on_steps: ['step_Format QA'] });
    expect(patches).toContainEqual({ depends_on_steps: ['step_Grade Repo', 'step_Deep Scan'] });

    // total_steps updated on each chain
    const totalSteps = supabaseStub.update.mock.calls
      .map((c) => c[0])
      .filter((p): p is { total_steps: number } => Boolean(p) && typeof (p as { total_steps?: unknown }).total_steps === 'number');
    expect(totalSteps.map((p) => p.total_steps).sort()).toEqual([4, 4, 5]);
  });

  it('is idempotent — existing chains are reused, not re-created', async () => {
    mockGetChain
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-maas', slug: 'maas-monthly-cycle' } as never)
      .mockResolvedValueOnce({ id: 'existing-audit', slug: 'audit-delivery' } as never)
      .mockResolvedValueOnce({ id: 'existing-research', slug: 'research-brief-delivery' } as never);

    await seedMissionChains();
    const second = await seedMissionChains();

    expect(second.errors).toEqual([]);
    expect(second.seeded.map((s) => s.id)).toEqual(['existing-maas', 'existing-audit', 'existing-research']);
    // first run created everything; second run created nothing
    expect(mockCreateChain).toHaveBeenCalledTimes(3);
    expect(mockAddSteps).toHaveBeenCalledTimes(3);
    expect(mockCreateDraymondClient).toHaveBeenCalledTimes(3);
    expect(mockGetChain).toHaveBeenCalledTimes(6);
  });

  it('captures a missing registry entity as a per-chain error without aborting the rest', async () => {
    mockGetEntity.mockImplementation(async (slug) => {
      if (slug === 'grader') return null;
      return { id: `ent_${slug}` } as never;
    });
    const result = await seedMissionChains();
    expect(result.seeded.map((s) => s.slug).sort()).toEqual(['maas-monthly-cycle', 'research-brief-delivery']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.name).toBe('Audit Delivery');
    expect(result.errors[0]!.error).toContain('grader');
    expect(mockCreateChain).toHaveBeenCalledTimes(2);
  });

  it('isolates a throwing chain creation to its own error entry', async () => {
    mockCreateChain.mockImplementation(async (input) => {
      if (input.slug === 'audit-delivery') throw new Error('db timeout');
      return { id: `chain_${input.slug}`, slug: input.slug } as never;
    });
    const result = await seedMissionChains();
    expect(result.seeded).toHaveLength(2);
    expect(result.errors).toEqual([{ name: 'Audit Delivery', error: 'db timeout' }]);
  });

  it('isolates a failing existing-chain lookup to its own error entry', async () => {
    mockGetChain.mockImplementation(async (slug) => {
      if (slug === 'research-brief-delivery') throw new Error('db down');
      return null;
    });
    const result = await seedMissionChains();
    expect(result.errors).toEqual([{ name: 'Research Brief Delivery', error: 'db down' }]);
    expect(result.seeded).toHaveLength(2);
  });

  it('skips dependency patches whose target step was not created', async () => {
    mockAddSteps.mockImplementation(async (inputs) =>
      inputs.filter((i) => i.name !== 'Format QA').map((i) => ({ ...i, id: `step_${i.name}` })) as never,
    );
    const result = await seedMissionChains();
    expect(result.errors).toEqual([]);
    expect(result.seeded).toHaveLength(3);
    const patches = depPatches();
    // Compile Client Package's dependency on the missing Format QA is dropped
    expect(patches.some((p) => p.depends_on_steps.length === 0)).toBe(true);
    expect(patches).toContainEqual({ depends_on_steps: ['step_QA Gate'] });
  });

  it('logs but survives dependency-patch database errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    supabaseStub.eq.mockResolvedValue({ error: { message: 'db locked' } });
    const result = await seedMissionChains();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('db locked'));
    expect(result.errors).toEqual([]);
    expect(result.seeded).toHaveLength(3);
    consoleError.mockRestore();
  });
});
