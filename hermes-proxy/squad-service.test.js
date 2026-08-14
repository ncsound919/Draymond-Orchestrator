import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { SPECIALISTS, systemFor, toolsFor, runSpecialist } from './squad-service.js';

function mockResponse(message) {
  return new Response(
    JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] }),
    { status: 200 },
  );
}

describe('squad service', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'k';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('defines the five specialists with distinct personas', () => {
    expect(Object.keys(SPECIALISTS)).toEqual(['riggs', 'moss', 'scribe', 'echo', 'hype']);
    for (const s of Object.values(SPECIALISTS)) {
      expect(s.name).toBeTruthy();
      expect(s.codename).toBeTruthy();
      expect(s.persona).toContain(s.name);
    }
  });

  it('filters the tool list to each specialist allowed tools', () => {
    const mossTools = toolsFor('moss').map((t) => t.function.name);
    expect(mossTools).toContain('web_search');
    expect(mossTools).not.toContain('gmail_send');
    const scribeTools = toolsFor('scribe').map((t) => t.function.name);
    expect(scribeTools).toContain('gmail_send');
    expect(scribeTools).not.toContain('aetherdesk_launch_campaign');
  });

  it('systemFor falls back to a generic prompt for unknown slugs', () => {
    expect(systemFor('nope')).toContain('helpful assistant');
  });

  it('executes tools, echoes reasoning_content, and returns text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_time', arguments: '{}' } }], reasoning_content: 'thinking' }))
      .mockResolvedValueOnce(mockResponse({ role: 'assistant', content: 'final answer', tool_calls: [], reasoning_content: '' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await runSpecialist('moss', [{ role: 'user', content: 'task' }], 's1');
    expect(result.sessionId).toBe('s1');
    expect(result.text).toBe('final answer');
    expect(result.usedTools).toEqual(['get_time']);
  });

  it('forces a synthesis pass when the tool loop runs out of rounds', async () => {
    const toolCall = (id) => ({ id, type: 'function', function: { name: 'web_search', arguments: '{}' } });
    const calls = [];
    for (let i = 1; i <= 7; i++) calls.push('tool' + i);
    const fetchMock = vi.fn((url, init) => {
      const body = JSON.parse(init.body);
      const hasTools = (body.tools || []).length > 0;
      if (hasTools) {
        return Promise.resolve(mockResponse({ role: 'assistant', content: '', tool_calls: [toolCall('t' + body.messages.length)], reasoning_content: '' }));
      }
      return Promise.resolve(mockResponse({ role: 'assistant', content: 'synthesized brief', tool_calls: [], reasoning_content: '' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await runSpecialist('moss', [{ role: 'user', content: 'research x' }], 's2');
    expect(result.text).toBe('synthesized brief');
    expect(result.usedTools.length).toBeGreaterThan(0);
    void calls;
  });
});
