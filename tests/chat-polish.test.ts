import { describe, it, expect, vi } from 'vitest';
import { humanizeResponse } from '@/lib/draymond/chat-polish';

vi.mock('@/lib/draymond/llm', () => ({
  callLLM: vi.fn(async () => 'LLM summary'),
}));

describe('humanizeResponse', () => {
  it('renders the dashboard summary deterministically when all agents are healthy', async () => {
    const raw = JSON.stringify({
      total_agents: 48,
      healthy_agents: 48,
      degraded_agents: 0,
      stalled_agents: 0,
      pending_actions: 0,
      actions_last_24h: 12,
      events_last_24h: 1331,
      handoffs_last_24h: 4,
      avg_confidence_last_24h: 0.82,
      top_events: [],
    });
    const out = await humanizeResponse(raw);
    expect(out).toContain('All 48 agents are healthy and online.');
    expect(out).not.toContain('total_agents');
  });

  it('flags stalled agents in the dashboard summary', async () => {
    const raw = JSON.stringify({
      total_agents: 48,
      healthy_agents: 45,
      degraded_agents: 0,
      stalled_agents: 3,
      pending_actions: 2,
      actions_last_24h: 12,
      events_last_24h: 10,
      handoffs_last_24h: 0,
      avg_confidence_last_24h: 0.7,
      top_events: [],
    });
    const out = await humanizeResponse(raw);
    expect(out).toContain('3 of 48 agents need attention');
    expect(out).toContain('2 actions waiting for your review');
  });

  it('falls back to the LLM for arbitrary JSON', async () => {
    const out = await humanizeResponse(JSON.stringify({ chain_id: 'abc', steps: 4, status: 'ok' }));
    expect(out).toBe('LLM summary');
  });

  it('strips mechanical Draymond/Route prefixes from plain text', async () => {
    const out = await humanizeResponse('[Draymond] Entity "foo" not found.');
    expect(out).toBe('Entity "foo" not found.');
  });

  it('returns a sane default for empty input', async () => {
    const out = await humanizeResponse('');
    expect(out).toBe('Done.');
  });
});
