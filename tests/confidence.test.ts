import { describe, expect, it } from 'vitest';
import { evaluateConfidence } from '../src/lib/draymond/index';
import type { ActionRiskLevel } from '../src/lib/draymond/types';

// evaluateConfidence(confidence, risk, thresholdAuto, thresholdReview)
// - auto_execute when confidence >= thresholdAuto * riskMultiplier
// - queue_for_review when between review and auto
// - block when below review threshold

const RISK_MULTIPLIERS: Record<ActionRiskLevel, number> = {
  safe: 0.8,
  low: 0.9,
  medium: 1.0,
  high: 1.15,
  critical: 1.3,
};

describe('evaluateConfidence', () => {
  it('auto-executes low-risk actions above the auto threshold', () => {
    const decision = evaluateConfidence(0.85, 'low', 0.7, 0.5);
    expect(decision.action).toBe('auto_execute');
    expect(decision.confidence_score).toBe(0.85);
    expect(decision.risk_level).toBe('low');
  });

  it('queues for review between review and auto thresholds', () => {
    const decision = evaluateConfidence(0.6, 'medium', 0.7, 0.5);
    expect(decision.action).toBe('queue_for_review');
    expect(decision.reasoning).toContain('queuing for human review');
  });

  it('blocks below the review threshold', () => {
    const decision = evaluateConfidence(0.2, 'critical', 0.7, 0.5);
    expect(decision.action).toBe('block');
    expect(decision.reasoning).toContain('blocked');
  });

  it('applies risk multipliers (high risk needs more confidence)', () => {
    const high = evaluateConfidence(0.8, 'high', 0.7, 0.5);
    const safe = evaluateConfidence(0.8, 'safe', 0.7, 0.5);
    // high multiplies threshold by 1.15 -> 0.805, so 0.8 must NOT auto-execute
    expect(high.action).not.toBe('auto_execute');
    // safe multiplies by 0.8 -> 0.56, so 0.8 auto-executes
    expect(safe.action).toBe('auto_execute');
  });

  it('caps the auto threshold at MAX_CONFIDENCE_THRESHOLD', () => {
    const decision = evaluateConfidence(0.999, 'critical', 0.99, 0.5);
    expect(decision.threshold_auto).toBeLessThanOrEqual(0.999);
  });

  it('validates threshold ordering (review <= auto)', () => {
    const decision = evaluateConfidence(0.7, 'critical', 0.7, 0.5);
    expect(decision.threshold_review).toBeLessThanOrEqual(decision.threshold_auto);
  });

  it('coerces out-of-range confidence to 0 (blocked)', () => {
    const decision = evaluateConfidence(1.5, 'safe', 0.7, 0.5);
    expect(decision.confidence_score).toBe(0);
    expect(decision.action).toBe('block');
  });

  it('coerces NaN confidence to 0', () => {
    const decision = evaluateConfidence(Number.NaN, 'low', 0.7, 0.5);
    expect(decision.confidence_score).toBe(0);
  });

  it('returns thresholds adjusted by the risk multiplier', () => {
    const decision = evaluateConfidence(0.9, 'critical', 0.7, 0.5);
    const mult = RISK_MULTIPLIERS.critical;
    expect(decision.threshold_auto).toBeCloseTo(0.7 * mult, 5);
    expect(decision.threshold_review).toBeCloseTo(0.5 * mult, 5);
  });
});
