import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  buildRetrievedContextBlock,
  buildExecutionBlock,
  getDomainPrompt,
} from '@/lib/mathx';

describe('buildPrompt', () => {
  it('prepends the mode prefix', () => {
    const p = buildPrompt('what is x', 'probability');
    expect(p).toContain('PROBABILITY MODE');
    expect(p.endsWith('what is x')).toBe(true);
  });

  it('uses the domain prefix when it overrides the mode', () => {
    const p = buildPrompt('q', 'domain', 'financial_math');
    expect(p).toContain('FINANCIAL MATHEMATICS');
  });

  it('falls back to scientist for unknown modes', () => {
    const p = buildPrompt('q', 'does-not-exist');
    expect(p).toContain('SCIENTIST MODE');
  });
});

describe('buildRetrievedContextBlock', () => {
  it('returns empty for no chunks', () => {
    expect(buildRetrievedContextBlock([])).toBe('');
  });

  it('formats chunks with scores', () => {
    const block = buildRetrievedContextBlock([
      { source: 'src-1', text: 'theorem', score: 0.4567 },
    ]);
    expect(block).toContain('Retrieved Context');
    expect(block).toContain('src-1');
    expect(block).toContain('(score: 0.457)');
    expect(block).toContain('theorem');
  });
});

describe('buildExecutionBlock', () => {
  it('returns empty when undefined', () => {
    expect(buildExecutionBlock()).toBe('');
  });

  it('includes stdout and error blocks', () => {
    const block = buildExecutionBlock({ stdout: '0.5', error: 'bad' });
    expect(block).toContain('0.5');
    expect(block).toContain('bad');
  });

  it('includes only stdout when no error', () => {
    const block = buildExecutionBlock({ stdout: '0.5' });
    expect(block).toContain('0.5');
    expect(block).not.toContain('error');
  });
});

describe('getDomainPrompt', () => {
  it('returns the domain persona', () => {
    const p = getDomainPrompt('control_theory');
    expect(p).toContain('Control Theory');
  });

  it('returns empty string for unknown domains', () => {
    expect(getDomainPrompt('nope')).toBe('');
  });
});
