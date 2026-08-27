import { describe, expect, it } from 'vitest';
import { vehicleProgress, TRAVEL_MS } from '../../src/components/visualizer/render/motion';
import type { Vehicle } from '../../src/components/visualizer/state/types';

const mk = (startedAt: number, status: Vehicle['status'] = 'transit', progress = 0): Vehicle => ({
  id: 'v',
  jobName: 'x',
  from: 'scheduler',
  to: 'litellm',
  progress,
  status,
  startedAt,
});

describe('vehicle motion', () => {
  it('clamps progress to 0..1 during transit', () => {
    expect(vehicleProgress(mk(1000), 1000)).toBe(0);
    expect(vehicleProgress(mk(1000), 1000 + TRAVEL_MS)).toBe(1);
    expect(vehicleProgress(mk(1000), 1000 + TRAVEL_MS * 2)).toBe(1);
  });
  it('returns stored progress for non-transit vehicles', () => {
    expect(vehicleProgress(mk(0, 'arrived', 1), 999999)).toBe(1);
    expect(vehicleProgress(mk(0, 'failed', 0.5), 999999)).toBe(0.5);
  });
  it('interpolates linearly mid-trip', () => {
    const half = vehicleProgress(mk(1000), 1000 + TRAVEL_MS / 2);
    expect(half).toBeCloseTo(0.5, 5);
  });
});