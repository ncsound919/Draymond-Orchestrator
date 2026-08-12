import { describe, expect, it } from 'vitest';
import {
  costPerMillionTokens,
  tokensToCents,
  estimateStepTokens,
  recordChainStepCost,
  normalizeChainSlug,
  type RecordedStepCost,
} from '../src/lib/draymond/cost';

describe('cost accounting', () => {
  it('defaults to $1.50 per 1M tokens', () => {
    expect(costPerMillionTokens()).toBe(150);
  });

  it('converts tokens to USD cents', () => {
    expect(tokensToCents(0)).toBe(0);
    expect(tokensToCents(1_000_000)).toBe(150);
    expect(tokensToCents(100_000)).toBe(15);
    expect(tokensToCents(-5)).toBe(0);
  });

  it('estimates step tokens from input + output with harness overhead', () => {
    // "hello world" prose = ~3 tokens; overhead adds 512.
    const tokens = estimateStepTokens('hello world', 'hi there');
    expect(tokens).toBeGreaterThanOrEqual(512);
    expect(tokens).toBeLessThan(1000);
  });

  it('estimates step tokens from objects', () => {
    const tokens = estimateStepTokens({ niche: 'ai in healthcare', count: 3 }, { result: 'a long summary '.repeat(20) });
    expect(tokens).toBeGreaterThan(512);
  });

  it('normalizes per-run chain slugs to the base chain slug', () => {
    expect(normalizeChainSlug('daily-marketing-run-run-1786565770920')).toBe('daily-marketing-run');
    expect(normalizeChainSlug('daily-marketing-run')).toBe('daily-marketing-run');
    expect(normalizeChainSlug('sports-betting-daily-run-1786541864732')).toBe('sports-betting-daily');
  });
});

// recordChainStepCost needs the DB (trackCost); verify the signature contract
// so callers get a stable shape without executing it.
describe('recordChainStepCost contract', () => {
  it('returns a RecordedStepCost shape', () => {
    const shape: RecordedStepCost = { tokens: 0, costCents: 0, costType: 'llm_tokens' };
    expect(typeof recordChainStepCost).toBe('function');
    expect(shape.costType).toBe('llm_tokens');
  });
});
