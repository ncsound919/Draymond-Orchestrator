// src/components/visualizer/render/motion.ts
import type { Vehicle } from '../state/types';

export const TRAVEL_MS = 4000;

/** Interpolate a transit vehicle's progress from its spawn time. Non-transit
 * vehicles return their stored progress (arrived/failed are terminal). */
export function vehicleProgress(v: Vehicle, now: number, travelMs = TRAVEL_MS): number {
  if (v.status !== 'transit') return v.progress;
  const elapsed = Math.max(0, now - v.startedAt);
  return Math.min(1, elapsed / travelMs);
}