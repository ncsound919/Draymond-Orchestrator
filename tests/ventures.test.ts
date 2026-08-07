import { afterEach, describe, expect, it } from 'vitest';
import { classifyVentureRisk } from '../src/lib/draymond/ventures';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('classifyVentureRisk', () => {
  it('returns low for pure research/compute steps', () => {
    expect(classifyVentureRisk([
      { entity_slug: 'omni-research', action: 'research_generation' },
      { entity_slug: 'social-media-dashboard', action: 'generate_text' },
    ])).toBe('low');
  });

  it('returns critical when any step touches payments', () => {
    expect(classifyVentureRisk([
      { entity_slug: 'omni-research', action: 'research_generation' },
      { entity_slug: 'uplift-agent', action: 'billing_checkout' },
    ])).toBe('critical');
  });

  it('returns high when any step posts externally or mutates irreversibly', () => {
    expect(classifyVentureRisk([
      { entity_slug: 'social-media-dashboard', action: 'schedule_posts' },
    ])).toBe('high');
    expect(classifyVentureRisk([
      { entity_slug: 'recursive-ip', action: 'mint' },
    ])).toBe('high');
  });
});
