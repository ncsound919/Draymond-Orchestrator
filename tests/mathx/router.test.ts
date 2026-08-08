import { describe, expect, it } from 'vitest';
import {
  preferredProviderForMode,
  checkOllamaHealth,
  maxTokensForMode,
  MODE_MAX_TOKENS,
  type MathProvider,
} from '@/lib/mathx/router';

describe('preferredProviderForMode', () => {
  const has = (p: MathProvider) => p === 'qwen' || p === 'deepseek';

  it('routes formula and deep-solve to the math specialist', () => {
    expect(preferredProviderForMode('formula', has)).toBe('qwen');
    expect(preferredProviderForMode('deep-solve', has)).toBe('qwen');
  });

  it('falls back when the specialist has no key', () => {
    const noQwen = (p: MathProvider) => p === 'deepseek';
    expect(preferredProviderForMode('formula', noQwen)).toBe('deepseek');
    expect(preferredProviderForMode('formula', () => false)).toBe('opencode-free');
  });

  it('routes reasoning modes to deepseek', () => {
    expect(preferredProviderForMode('scientist', has)).toBe('deepseek');
    expect(preferredProviderForMode('hypothesis', has)).toBe('deepseek');
    expect(preferredProviderForMode('synergy', has)).toBe('deepseek');
  });

  it('defaults everything else to the cheap tier', () => {
    expect(preferredProviderForMode('probability', has)).toBe('opencode-free');
    expect(preferredProviderForMode('unknown-mode', has)).toBe('opencode-free');
  });
});

describe('maxTokensForMode', () => {
  it('uses per-mode budgets', () => {
    expect(maxTokensForMode('deep-solve')).toBe(8000);
    expect(maxTokensForMode('formula')).toBe(6000);
    expect(maxTokensForMode('scientist')).toBe(4000);
  });

  it('falls back for unknown modes', () => {
    expect(maxTokensForMode('nope')).toBe(4000);
    expect(maxTokensForMode('nope', 1000)).toBe(1000);
  });

  it('exposes the budget table', () => {
    expect(MODE_MAX_TOKENS['probability']).toBe(4000);
  });
});

describe('checkOllamaHealth', () => {
  it('returns false when the endpoint is unreachable', async () => {
    const ok = await checkOllamaHealth('http://localhost:1', 200);
    expect(ok).toBe(false);
  });
});
