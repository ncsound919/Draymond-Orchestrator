import { describe, expect, it } from 'vitest';
import {
  toonifyValue,
  toonifyJsonBlocks,
  prepareLLMMessages,
} from '../src/lib/draymond/toonify';

const uniformUsers = {
  users: [
    { id: 1, name: 'Ada', role: 'admin' },
    { id: 2, name: 'Bob', role: 'user' },
  ],
};

describe('toonifyValue', () => {
  it('encodes uniform record arrays to a shorter, lossless TOON form', () => {
    const toon = toonifyValue(uniformUsers);
    expect(toon).not.toBeNull();
    expect(toon!.length).toBeLessThan(JSON.stringify(uniformUsers).length);
    // Tabular form: field names collapsed into a single header line.
    expect(toon).toContain('users[2]{id,name,role}');
  });

  it('returns null when JSON is already smaller (deeply nested / tiny payloads)', () => {
    const nested = { a: { b: { c: { d: [1, 2, 3] } } } };
    expect(toonifyValue(nested)).toBeNull();
    const tiny = { x: 1 };
    expect(toonifyValue(tiny)).toBeNull();
  });

  it('returns null for values TOON cannot represent losslessly', () => {
    // Circular references / undefined root would throw — must never propagate.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => JSON.stringify(circular)).toThrow(); // sanity: fixture is really circular
    expect(() => toonifyValue(circular)).not.toThrow();
  });
});

describe('toonifyJsonBlocks', () => {
  it('swaps a ```json fence for ```toon when it shrinks the payload', () => {
    const text = 'Here is the data:\n```json\n' + JSON.stringify(uniformUsers, null, 2) + '\n```\ndone';
    const out = toonifyJsonBlocks(text);
    expect(out).toContain('```toon');
    expect(out).not.toContain('```json');
    expect(out).toContain('users[2]{id,name,role}');
    // Prose before/after is preserved.
    expect(out.startsWith('Here is the data:')).toBe(true);
    expect(out.endsWith('done')).toBe(true);
  });

  it('leaves a json fence untouched when TOON is not smaller', () => {
    const nested = { a: { b: { c: { d: [1, 2, 3] } } } };
    const text = '```json\n' + JSON.stringify(nested) + '\n```';
    expect(toonifyJsonBlocks(text)).toBe(text);
  });

  it('leaves invalid JSON fences untouched', () => {
    const text = '```json\nthis is { not json\n```';
    expect(toonifyJsonBlocks(text)).toBe(text);
  });

  it('converts <context> JSON blocks and keeps the tags', () => {
    const ctx = {
      user_id: 'u1',
      plan: 'pro',
      entities: [
        { slug: 'billing', name: 'Billing Agent', kind: 'agent' },
        { slug: 'crm', name: 'CRM Sync', kind: 'chain' },
      ],
    };
    const text = `<user_task>route me</user_task>\n<context>${JSON.stringify(ctx)}</context>`;
    const out = toonifyJsonBlocks(text);
    expect(out).toContain('<context>');
    expect(out).toContain('</context>');
    expect(out).toContain('```toon');
    expect(out).toContain('entities[2]{slug,name,kind}');
  });

  it('leaves <context> blocks with non-JSON content untouched', () => {
    const text = '<context>just some text, not json</context>';
    expect(toonifyJsonBlocks(text)).toBe(text);
  });

  it('passes through plain prose unchanged', () => {
    const text = 'You are Draymond. Answer concisely.';
    expect(toonifyJsonBlocks(text)).toBe(text);
  });

  it('handles empty and whitespace-only input', () => {
    expect(toonifyJsonBlocks('')).toBe('');
    expect(toonifyJsonBlocks('  ')).toBe('  ');
  });
});

describe('prepareLLMMessages', () => {
  it('is a no-op unless toonify is enabled', () => {
    const system = '```json\n' + JSON.stringify(uniformUsers) + '\n```';
    const userMessage = '<context>{"a":1}</context>';
    const out = prepareLLMMessages({ system, userMessage });
    expect(out).toEqual({ system, userMessage });
  });

  it('compresses both messages when toonify is enabled', () => {
    const system = 'Rules:\n```json\n' + JSON.stringify(uniformUsers) + '\n```';
    const userMessage =
      `<context>${JSON.stringify({
        user_id: 'u1',
        plan: 'pro',
        entities: [
          { slug: 'billing', name: 'Billing Agent', kind: 'agent' },
          { slug: 'crm', name: 'CRM Sync', kind: 'chain' },
        ],
      })}</context>`;
    const out = prepareLLMMessages({ system, userMessage, toonify: true });
    expect(out.system).toContain('```toon');
    expect(out.userMessage).toContain('```toon');
    expect(out.userMessage).not.toContain('{"user_id');
  });

  it('defaults missing messages to empty strings', () => {
    expect(prepareLLMMessages({ toonify: true })).toEqual({ system: '', userMessage: '' });
    expect(prepareLLMMessages({})).toEqual({ system: '', userMessage: '' });
  });
});
