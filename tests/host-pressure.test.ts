import { describe, it, expect } from 'vitest';
import { pressureDeferReason, hostPressure } from '../src/lib/draymond/scheduler';

/**
 * HOST-PRESSURE GATE (2026-09-28).
 *
 * The scheduler had time windows, token caps and leases but nothing that looked
 * at the machine. These tests pin the deferral policy:
 *   < heavy     -> nothing gated
 *   heavy..hard -> heavy jobs (chains + known-heavy handler families) defer
 *   >= hard     -> everything defers EXCEPT health checks / notifications
 * Deferral reuses the existing skip-and-advance path, so a deferred job is
 * never counted as a failure.
 */

const limits = { heavy: 0.6, hard: 0.85, enabled: true };

const chain = { job_type: 'chain', job_config: {} } as const;
const health = { job_type: 'health_check', job_config: {} } as const;
const notify = { job_type: 'notification', job_config: {} } as const;
const handler = (h: string) => ({ job_type: 'custom', job_config: { handler: h } }) as const;

describe('host-pressure gate', () => {
  it('does not gate anything below the heavy threshold', () => {
    expect(pressureDeferReason(chain, 0.0, limits)).toBeNull();
    expect(pressureDeferReason(chain, 0.59, limits)).toBeNull();
    expect(pressureDeferReason(handler('oncology_revalidation'), 0.59, limits)).toBeNull();
  });

  it('defers heavy jobs in the middle band', () => {
    expect(pressureDeferReason(chain, 0.7, limits)).toMatch(/heavy job/);
    expect(pressureDeferReason(handler('science_publication_loop'), 0.7, limits)).toMatch(/heavy job/);
    expect(pressureDeferReason(handler('benchmark_entities'), 0.7, limits)).toMatch(/heavy job/);
    expect(pressureDeferReason(handler('dream_cycle'), 0.7, limits)).toMatch(/heavy job/);
  });

  it('lets light jobs through in the middle band', () => {
    expect(pressureDeferReason(handler('ingest_news'), 0.7, limits)).toBeNull();
    expect(pressureDeferReason(handler('treasurer_cash_pulse'), 0.7, limits)).toBeNull();
  });

  it('defers everything at/above the hard threshold, except health checks and notifications', () => {
    expect(pressureDeferReason(handler('ingest_news'), 0.9, limits)).toMatch(/deferring all/);
    expect(pressureDeferReason(chain, 0.9, limits)).toMatch(/deferring all/);
    // Never blind yourself: telemetry keeps running under any load.
    expect(pressureDeferReason(health, 0.99, limits)).toBeNull();
    expect(pressureDeferReason(notify, 0.99, limits)).toBeNull();
  });

  it('is a no-op when disabled', () => {
    expect(pressureDeferReason(chain, 0.99, { ...limits, enabled: false })).toBeNull();
    expect(pressureDeferReason(handler('science_publication_loop'), 0.99, { ...limits, enabled: false })).toBeNull();
  });

  it('hostPressure() is a finite value in [0,1]', () => {
    const p = hostPressure();
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
