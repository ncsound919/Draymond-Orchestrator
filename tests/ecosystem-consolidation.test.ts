import { describe, it, expect } from 'vitest';
import {
  AGENT_RUNTIME_SLUG,
  CONSOLIDATED_ENTITIES,
  CONSOLIDATION_SOURCES,
  ECOSYSTEM_GOVERNOR,
  POLICY_KERNEL_SLUG,
  consolidatedEntityInserts,
  consolidationSummary,
} from '@/lib/draymond/ecosystem-consolidation';

describe('ecosystem consolidation manifest', () => {
  it('declares all eight source repos exactly once', () => {
    const ids = CONSOLIDATION_SOURCES.map((s) => s.id).sort();
    expect(ids).toEqual(
      [
        'ace',
        'aetherdesk-call-center',
        'dev-brain',
        'hermes-agent-main',
        'integrations',
        'oss-marketing-stack',
        'overlay-finance',
        'staffing-commission-engine',
      ].sort()
    );
  });

  it('every source is governed by the single governor', () => {
    for (const source of CONSOLIDATION_SOURCES) {
      expect(source.governedBy).toBe(ECOSYSTEM_GOVERNOR);
    }
  });

  it('has exactly one policy kernel and one agent runtime', () => {
    const roles = CONSOLIDATION_SOURCES.map((s) => s.role);
    expect(roles.filter((r) => r === 'policy-kernel')).toHaveLength(1);
    expect(roles.filter((r) => r === 'agent-runtime')).toHaveLength(1);
  });

  it('maps the policy kernel and runtime slugs to their sources', () => {
    const ace = CONSOLIDATION_SOURCES.find((s) => s.role === 'policy-kernel');
    const hermes = CONSOLIDATION_SOURCES.find((s) => s.role === 'agent-runtime');
    expect(ace?.entitySlugs).toContain(POLICY_KERNEL_SLUG);
    expect(hermes?.entitySlugs).toContain(AGENT_RUNTIME_SLUG);
  });

  it('does not re-register existing entities', () => {
    const slugs = CONSOLIDATED_ENTITIES.map((e) => e.slug);
    expect(slugs).not.toContain('recursive-ip');
    expect(slugs).not.toContain('overlay-finance');
    expect(slugs).not.toContain('aetherdesk');
  });

  it('new entities have unique, registry-valid slugs', () => {
    const slugs = CONSOLIDATED_ENTITIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    }
  });

  it('registers the policy kernel and runtime as real entities', () => {
    const slugs = CONSOLIDATED_ENTITIES.map((e) => e.slug);
    expect(slugs).toContain(POLICY_KERNEL_SLUG);
    expect(slugs).toContain(AGENT_RUNTIME_SLUG);
  });

  it('keeps honesty labels: every source names a blocker and not all are real', () => {
    for (const source of CONSOLIDATION_SOURCES) {
      expect(source.blockers.length).toBeGreaterThan(0);
      expect(source.entitySlugs.length).toBeGreaterThan(0);
    }
    expect(CONSOLIDATION_SOURCES.some((s) => s.reality === 'vendored')).toBe(true);
    expect(CONSOLIDATION_SOURCES.some((s) => s.reality !== 'real')).toBe(true);
  });

  it('consolidatedEntityInserts returns the declared entities', () => {
    expect(consolidatedEntityInserts()).toBe(CONSOLIDATED_ENTITIES);
  });

  it('summarises consistently', () => {
    const summary = consolidationSummary();
    expect(summary.sources).toBe(8);
    expect(summary.newEntities).toBe(CONSOLIDATED_ENTITIES.length);
    const total = Object.values(summary.byReality).reduce((a, b) => a + b, 0);
    expect(total).toBe(8);
  });
});
