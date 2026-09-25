import { describe, expect, it, vi } from 'vitest';

const { getEntityMock } = vi.hoisted(() => ({ getEntityMock: vi.fn() }));

vi.mock('../src/lib/draymond/registry', () => ({ getEntity: getEntityMock }));

import {
  getStepSchema,
  validateInputMapping,
  validateStepInput,
} from '../src/lib/draymond/step-schemas';

describe('validateStepInput', () => {
  it('passes valid input for a registered action', () => {
    const check = validateStepInput('overlay-marketing-actions', 'generate_image', {
      prompt: 'a sunset over the ocean',
    });
    expect(check).toEqual({ ok: true });
  });

  it('rejects missing required fields with a clear path', () => {
    const check = validateStepInput('overlay-marketing-actions', 'generate_image', {});
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toMatch(/field "prompt"/);
    }
  });

  it('passes unregistered (entitySlug, action) combos (opt-in)', () => {
    expect(validateStepInput('any-service', 'any_action', {}).ok).toBe(true);
  });

  it('exposes the schema for a registered action', () => {
    expect(getStepSchema('overlay-marketing-actions', 'generate_image')).toBeDefined();
    expect(getStepSchema('nope', 'nope')).toBeUndefined();
  });
});

describe('validateInputMapping', () => {
  it('rejects an input_mapping that omits a required field', async () => {
    getEntityMock.mockResolvedValue({ id: 'e1', slug: 'overlay-marketing-actions' });
    const check = await validateInputMapping('e1', 'generate_image', {
      style: 'photographic',
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error).toMatch(/field in input_mapping.*"prompt"/);
    }
  });

  it('passes an input_mapping that covers required fields', async () => {
    getEntityMock.mockResolvedValue({ id: 'e1', slug: 'overlay-marketing-actions' });
    const check = await validateInputMapping('e1', 'generate_image', {
      prompt: '$.steps.text.output.content',
    });
    expect(check.ok).toBe(true);
  });

  it('passes when the entity cannot be resolved (best-effort)', async () => {
    getEntityMock.mockResolvedValue(null);
    const check = await validateInputMapping('ghost', 'generate_image', {});
    expect(check.ok).toBe(true);
  });

  it('passes for unregistered actions', async () => {
    getEntityMock.mockResolvedValue({ id: 'e1', slug: 'overlay-marketing-actions' });
    const check = await validateInputMapping('e1', 'unregistered_action', {});
    expect(check.ok).toBe(true);
  });
});
