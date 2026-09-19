import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  preferredProviderForMode,
  checkOllamaHealth,
  fetchLocalModels,
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

describe('fetchLocalModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads Ollama /api/tags', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).endsWith('/api/tags')
        ? { ok: true, json: async () => ({ models: [{ name: 'llama3.2' }] }) }
        : { ok: false, json: async () => ({}) },
    ));
    expect(await fetchLocalModels('http://localhost:11434', 200)).toEqual(['llama3.2']);
  });

  it('falls back to /v1/models for llama.cpp (no /api/tags)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).endsWith('/v1/models')
        ? { ok: true, json: async () => ({ data: [{ id: 'minicpm5-2b' }] }) }
        : { ok: false, json: async () => ({}) },
    ));
    expect(await fetchLocalModels('http://localhost:11434', 200)).toEqual(['minicpm5-2b']);
    expect(await checkOllamaHealth('http://localhost:11434', 200)).toBe(true);
  });

  it('returns [] when both endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await fetchLocalModels('http://localhost:11434', 200)).toEqual([]);
  });
});
