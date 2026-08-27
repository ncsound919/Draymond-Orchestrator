import { describe, expect, it } from 'vitest';
import { encodeSse, parseSseLine } from '../../src/app/api/visualizer/stream/route';

describe('visualizer SSE framing', () => {
  it('encodes a single data envelope', () => {
    const out = encodeSse({ type: 'connected', data: { message: 'hi' }, ts: 'x' });
    expect(out).toBe(`data: ${JSON.stringify({ type: 'connected', data: { message: 'hi' }, ts: 'x' })}\n\n`);
  });
  it('parses a data line back', () => {
    const env = { type: 'scheduler.job_started', data: { job_id: '1' }, ts: 't' };
    expect(parseSseLine(`data: ${JSON.stringify(env)}`)).toEqual(env);
  });
});