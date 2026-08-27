// tests/visualizer/types-smoke.test.ts
import { describe, expect, it } from 'vitest';
import { isHealthState, isVehicleStatus, isLogKind } from '../../src/components/visualizer/state/types';

describe('sim type guards', () => {
  it('accepts only known health states', () => {
    expect(isHealthState('healthy')).toBe(true);
    expect(isHealthState('down')).toBe(true);
    expect(isHealthState('exploded')).toBe(false);
  });
  it('accepts only known vehicle statuses', () => {
    expect(isVehicleStatus('transit')).toBe(true);
    expect(isVehicleStatus('failed')).toBe(true);
    expect(isVehicleStatus('waiting')).toBe(false);
  });
  it('accepts only known log kinds', () => {
    expect(isLogKind('success')).toBe(true);
    expect(isLogKind('fail')).toBe(true);
    expect(isLogKind('error')).toBe(false);
  });
});