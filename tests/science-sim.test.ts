import { describe, expect, it } from 'vitest';
import { runModelById, runModelSpec } from '@/lib/science/sim';

describe('science sim shell-out', () => {
  it('runs a seeded model by id deterministically', async () => {
    const a = await runModelById('sports-03-biological-load');
    const b = await runModelById('sports-03-biological-load');
    expect(a.error).toBeUndefined();
    expect(a.evidence_tier).toBe('E1');
    expect(a.ticks).toBeGreaterThan(0);
    expect(a.series.length).toBeGreaterThan(0);
    expect(a.outputs).toHaveProperty('fatigue');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 90_000);

  it('runs an inline model spec', async () => {
    const out = await runModelSpec({
      model_id: 'inline-test',
      state_vars: ['x'],
      params: { step: 1 },
      initial_state: { x: 0 },
      update_rules: { x: 'x + step' },
      outputs: ['x'],
      ticks: 5,
    });
    expect(out.error).toBeUndefined();
    expect(out.outputs.x).toBe(5);
  }, 90_000);

  it('returns an error-shaped result for an unknown model', async () => {
    const out = await runModelById('does-not-exist-model');
    expect(out.error).toContain('model not found');
    expect(out.evidence_tier).toBe('E4');
  }, 90_000);
});
