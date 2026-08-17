import { describe, expect, it } from 'vitest';
import {
  ndjsonSafeStringify,
  ndjsonLine,
  ndjsonParseLine,
  ndjsonLines,
} from '../src/lib/draymond/ndjson';

describe('ndjsonSafeStringify', () => {
  it('serializes plain objects', () => {
    expect(ndjsonSafeStringify({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  it('omits undefined and function values in objects', () => {
    const out = ndjsonSafeStringify({ a: undefined, b: 2, fn: () => {} });
    expect(JSON.parse(out)).toEqual({ b: 2 });
  });

  it('serializes top-level undefined as null', () => {
    expect(ndjsonSafeStringify(undefined)).toBe('null');
  });

  it('never throws on circular references', () => {
    const obj: Record<string, unknown> = { name: 'loop' };
    obj.self = obj;
    expect(() => ndjsonSafeStringify(obj)).not.toThrow();
    expect(ndjsonSafeStringify(obj)).toContain('[Circular]');
  });

  it('coerces BigInt losslessly', () => {
    const big = BigInt(123);
    const out = JSON.parse(ndjsonSafeStringify({ big }));
    expect(out.big).toBe(123);
  });
});

describe('ndjsonLine / ndjsonParseLine', () => {
  it('appends a trailing newline', () => {
    expect(ndjsonLine({ type: 'user' })).toBe('{"type":"user"}\n');
  });

  it('parses a valid line and rejects junk', () => {
    expect(ndjsonParseLine('{"type":"user"}\n')).toEqual({ type: 'user' });
    expect(ndjsonParseLine('not json')).toBeNull();
    expect(ndjsonParseLine('')).toBeNull();
    expect(ndjsonParseLine('# comment')).toBeNull();
  });
});

describe('ndjsonLines', () => {
  it('splits chunks into complete messages and skips blank/comment lines', async () => {
    const chunks = [
      '{"type":"user","content":"hel',
      'lo"}\n\n# skip me\n{"type":"assistant","content":"hi"',
      '}\n{"type":"done"}',
    ];
    const messages = [];
    for await (const m of ndjsonLines(chunks)) messages.push(m);
    expect(messages).toEqual([
      { type: 'user', content: 'hello' },
      { type: 'assistant', content: 'hi' },
      { type: 'done' },
    ]);
  });

  it('emits the trailing line without a newline at stream end', async () => {
    const messages = [];
    for await (const m of ndjsonLines(['{"a":1}'])) messages.push(m);
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('handles an async iterable input', async () => {
    async function* source() {
      yield '{"n":1}\n';
      yield '{"n":2}\n';
    }
    const messages = [];
    for await (const m of ndjsonLines(source())) messages.push(m);
    expect(messages).toEqual([{ n: 1 }, { n: 2 }]);
  });
});
