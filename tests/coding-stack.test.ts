import { describe, expect, it } from 'vitest';
import {
  CODING_STACK,
  codingStackSummary,
  getCodingLayer,
  resolveCodingTools,
} from '../src/lib/draymond/coding-stack';

describe('master coding stack', () => {
  it('has one canonical primary per layer (dedup)', () => {
    const primaries = CODING_STACK.map((l) => l.primary);
    expect(new Set(primaries).size).toBe(CODING_STACK.length);
    for (const layer of CODING_STACK) {
      expect(layer.tools).toContain(layer.primary);
      if (layer.fallback) expect(layer.tools).toContain(layer.fallback);
    }
  });

  it('codegen primary is the deepest coding agent', () => {
    expect(getCodingLayer('codegen')?.primary).toBe('uplift-agent');
    expect(getCodingLayer('codegen')?.fallback).toBe('megacode');
  });

  it('review primary is reporank, grader is the fallback', () => {
    expect(getCodingLayer('review')?.primary).toBe('reporank');
    expect(getCodingLayer('review')?.fallback).toBe('grader');
  });

  it('security is deduplicated to three narrow scanners', () => {
    expect(getCodingLayer('security')?.tools).toEqual([
      'claw-protect',
      'depscan',
      'nuclei-scanner',
    ]);
  });

  it('resolveCodingTools orders primary first with no dupes', () => {
    expect(resolveCodingTools('codegen')).toEqual([
      'uplift-agent',
      'megacode',
      'everything-claude-code',
      'sub-team',
    ]);
  });

  it('resolveCodingTools respects availability', () => {
    expect(resolveCodingTools('codegen', ['megacode', 'sub-team'])).toEqual([
      'megacode',
      'sub-team',
    ]);
  });

  it('summary is non-empty and mentions the stack', () => {
    expect(codingStackSummary()).toContain('Code Generation');
    expect(codingStackSummary()).toContain('uplift-agent');
  });
});
