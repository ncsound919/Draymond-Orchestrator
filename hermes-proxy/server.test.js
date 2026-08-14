import { describe, it, expect } from 'vitest';
import { sessionFromPayload, sseChunk, sseDone } from './server.js';

describe('server helpers', () => {
  it('derives session_id from metadata', () => {
    expect(sessionFromPayload({ metadata: { session_id: 'foo' } })).toBe('foo');
  });
  it('defaults session to "default"', () => {
    expect(sessionFromPayload({})).toBe('default');
  });
  it('builds SSE chunks and done', () => {
    const c = sseChunk('hi');
    expect(c).toContain('content');
    expect(sseDone()).toContain('[DONE]');
  });
});
