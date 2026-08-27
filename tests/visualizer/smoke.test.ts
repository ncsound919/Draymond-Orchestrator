// tests/visualizer/smoke.test.ts
import { describe, expect, it } from 'vitest';
import { initialState } from '../../src/components/visualizer/state/reducer';

describe('visualizer smoke', () => {
  it('initial state is coherent', () => {
    const s = initialState();
    expect(s.buildings).toEqual({});
    expect(s.signalLost).toBe(false);
    expect(Array.isArray(s.ticker)).toBe(true);
  });
});