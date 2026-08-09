import { describe, expect, it } from 'vitest';
import { MISSION_CHAIN_DEFS } from '../src/lib/draymond/mission-chains';

describe('mission chain templates', () => {
  it('defines the three delivery chains', () => {
    const slugs = MISSION_CHAIN_DEFS.map((c) => c.slug).sort();
    expect(slugs).toEqual(['audit-delivery', 'maas-monthly-cycle', 'research-brief-delivery']);
  });

  it('references only known entity slugs and valid actions', () => {
    const known = new Set([
      'grader', 'reporank', 'mutly', 'uplift-agent',
      'omni-research', 'social-media-dashboard', 'kaggle',
    ]);
    for (const chain of MISSION_CHAIN_DEFS) {
      for (const step of chain.steps) {
        expect(known.has(step.entitySlug), `${chain.slug}:${step.name} -> ${step.entitySlug}`).toBe(true);
        expect(step.action.length).toBeGreaterThan(0);
        expect(step.step_order).toBeGreaterThan(0);
      }
    }
  });

  it('orders steps so dependents have higher step_order', () => {
    for (const chain of MISSION_CHAIN_DEFS) {
      const byOrder = new Map(chain.steps.map((s) => [s.name, s.step_order]));
      for (const step of chain.steps) {
        for (const depName of step.depends_on) {
          const depOrder = byOrder.get(depName);
          expect(depOrder, `${chain.slug}: ${step.name} depends on ${depName}`).toBeLessThan(step.step_order);
        }
      }
    }
  });
});
