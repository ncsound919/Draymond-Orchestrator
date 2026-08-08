import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  truncateToTokens,
  chunkText,
  detectContentMode,
} from '@/lib/mathx/tokenizer';

describe('estimateTokens', () => {
  it('returns 0 for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('scales by mode multiplier', () => {
    expect(estimateTokens('hello world', 'prose')).toBe(3); // ceil(2 × 1.3)
    expect(estimateTokens('hello world', 'code')).toBe(4); // ceil(2 × 1.7)
    expect(estimateTokens('hello world', 'math')).toBe(4); // ceil(2 × 2.0)
  });

  it('defaults to prose', () => {
    expect(estimateTokens('a b c')).toBe(4); // ceil(3 × 1.3)
  });
});

describe('truncateToTokens', () => {
  it('returns short text unchanged', () => {
    const short = 'tiny';
    expect(truncateToTokens(short, 100)).toBe(short);
  });

  it('truncates long text to whole words', () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const text = words.join(' ');
    const out = truncateToTokens(text, 13, 'prose');
    expect(out).toBe('w0 w1 w2 w3 w4 w5 w6 w7 w8 w9…'); // floor(13 / 1.3) words + suffix
    expect(out.endsWith('…')).toBe(true);
    expect(out.split(' ')).toHaveLength(10);
  });
});

describe('chunkText', () => {
  it('chunks with no overlap', () => {
    const text = 'a b c d e f g h i j';
    const chunks = chunkText(text, 5, 0, 'prose'); // chunkWords = floor(5/1.3) = 3
    expect(chunks).toEqual(['a b c', 'd e f', 'g h i', 'j']);
  });

  it('preserves overlap when requested', () => {
    const text = 'a b c d e f g h i j';
    const chunks = chunkText(text, 10, 3, 'prose'); // chunkWords = 7, overlapWords = 2
    expect(chunks[0]).toBe('a b c d e f g');
    expect(chunks[1]).toBe('f g h i j');
  });
});

describe('detectContentMode', () => {
  it('detects math', () => {
    expect(detectContentMode('\\frac{a}{b} + \\int_0^1 x dx')).toBe('math');
  });

  it('detects code', () => {
    expect(detectContentMode('function f() { return 1; }')).toBe('code');
    expect(detectContentMode('import x from y')).toBe('code');
  });

  it('defaults to prose', () => {
    expect(detectContentMode('just some words')).toBe('prose');
  });
});
