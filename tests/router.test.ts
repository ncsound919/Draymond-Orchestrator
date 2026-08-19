import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEntities = vi.hoisted(() => [
  {
    slug: 'aetherdesk',
    name: 'AetherDesk Call Center',
    kind: 'service',
    description: 'Call center SaaS.',
    capabilities: ['agents', 'campaigns', 'leads', 'calls', 'health'],
    category: null,
    tags: [],
    is_active: true,
  },
]);

const mockChains = vi.hoisted(() => [
  { slug: 'morning-briefing', name: 'Morning Briefing', description: null, trigger_type: 'scheduled' },
  { slug: 'daily-marketing-run', name: 'Daily Marketing Run', description: null, trigger_type: 'scheduled' },
]);

// Mock the Supabase client so the router never touches next/headers.
vi.mock('../src/lib/draymond/client', () => ({
  createDraymondAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'draymond_entities') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: mockEntities, error: null }),
            }),
          }),
        };
      }
      if (table === 'draymond_chains') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: mockChains, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

// Router only uses logEvent from ./index — replace it with a no-op.
vi.mock('../src/lib/draymond/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/index')>();
  return { ...actual, logEvent: vi.fn(async () => {}) };
});

import {
  getRouterConfig,
  routeTask,
} from '../src/lib/draymond/router';

describe('router opencode-free provider', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENCODE_API_KEY;
    fetchMock.mockReset();
  });

  it('defaults to opencode-free deepseek-v4-flash-free', () => {
    expect(getRouterConfig().provider).toBe('opencode-free');
    expect(getRouterConfig().model).toBe('deepseek-v4-flash-free');
  });

  it('routes via the local Ollama tier first by default (local-first routing)', async () => {
    process.env.OPENCODE_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'invoke_entity',
                  confidence: 0.95,
                  entity_slug: 'aetherdesk',
                  action: 'list_agents',
                  input: {},
                  reasoning: 'local route',
                  alternatives: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list agents');

    expect(result.entity_slug).toBe('aetherdesk');
    expect(result.action).toBe('list_agents');
    // Local-first: only the local Ollama endpoint is hit (no paid call).
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('11434');
  });

  it('falls back to intent unknown on non-JSON response (tolerant parser)', async () => {
    process.env.OPENCODE_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'not json at all' } }] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list agents');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('direct-matches web search patterns without calling the LLM', async () => {
    process.env.OPENCODE_API_KEY = 'test-key';
    const result = await routeTask('search the web for react 19 features');
    expect(result.intent).toBe('web_search');
    expect(result.confidence).toBe(0.92);
    expect(result.input).toEqual({ query: 'react 19 features' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('direct-matches lookup/query patterns for web search', async () => {
    const result = await routeTask('look up the weather in chicago');
    expect(result.intent).toBe('web_search');
    expect(result.input).toEqual({ query: 'the weather in chicago' });
  });

  it('direct-matches deep system queries (crons, workflows, agenda, repairs)', async () => {
    for (const q of [
      'how are my crons doing',
      'how are the workflows running',
      'what needs repair',
      'what is on the agenda today',
      'how are the agents doing',
      'what did the brain find',
    ]) {
      const result = await routeTask(q);
      expect(result.intent, `expected query_status for "${q}"`).toBe('query_status');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('direct-matches a brain sweep request to the deterministic-brain entity', async () => {
    const result = await routeTask('run the brain');
    expect(result.intent).toBe('invoke_entity');
    expect(result.entity_slug).toBe('deterministic-brain');
    expect(result.action).toBe('sweep');
  });

  it('does not let an unresolved generic entity candidate block brain commands', async () => {
    // "invoke" is an entity prefix — without the reserved-command-first ordering
    // the parser would capture filler word "the" and bail before the brain matcher.
    const result = await routeTask('invoke the brain');
    expect(result.intent).toBe('invoke_entity');
    expect(result.entity_slug).toBe('deterministic-brain');
    expect(result.action).toBe('sweep');
  });

  it('direct-matches a natural-language chain request by name', async () => {
    // Templates are seeded as 'draft'; the router must still see them and match
    // "run the morning briefing" → morning-briefing without the LLM.
    const result = await routeTask('run the morning briefing');
    expect(result.intent).toBe('execute_chain');
    expect(result.chain_slug).toBe('morning-briefing');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('direct-matches trigger/start phrasings to chains by name', async () => {
    const r1 = await routeTask('trigger the daily marketing run');
    expect(r1.intent).toBe('execute_chain');
    expect(r1.chain_slug).toBe('daily-marketing-run');
  });
});

describe('router deterministic brain pre-route', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BRAIN_URL;
    delete process.env.OPENCODE_API_KEY;
    fetchMock.mockReset();
  });

  it('skips the paid LLM when the brain classifies with high confidence', async () => {
    process.env.BRAIN_URL = 'http://localhost:3210';
    process.env.OPENCODE_API_KEY = 'test-key';

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/reason')) {
        return new Response(
          JSON.stringify({
            decision: { chosen_skill: 'aetherdesk', confidence: 0.88 },
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list the agents');
    expect(result.entity_slug).toBe('aetherdesk');
    expect(result.confidence).toBe(0.88);
    expect(result.reasoning).toContain('skipped LLM routing');
    // Only the brain /reason call happened — the paid LLM endpoint never ran.
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/reason');
  });

  it('falls through to the local tier when brain confidence is too low', async () => {
    process.env.BRAIN_URL = 'http://localhost:3210';
    process.env.OPENCODE_API_KEY = 'test-key';

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/reason')) {
        return new Response(
          JSON.stringify({ decision: { chosen_skill: 'aetherdesk', confidence: 0.3 } }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'invoke_entity',
                  confidence: 0.95,
                  entity_slug: 'aetherdesk',
                  action: 'list_agents',
                  input: {},
                  reasoning: 'low brain conf so used local',
                  alternatives: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list agents');
    expect(result.entity_slug).toBe('aetherdesk');
    expect(result.action).toBe('list_agents');
    // brain /reason ran (1st call), then the local tier ran (2nd call).
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/reason');
    expect(String(fetchMock.mock.calls[1][0])).toContain('11434');
  });

  it('is a no-op when BRAIN_URL is unset (offline installs unchanged)', async () => {
    process.env.OPENCODE_API_KEY = 'test-key';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'invoke_entity',
                  confidence: 0.95,
                  entity_slug: 'aetherdesk',
                  action: 'list_agents',
                  input: {},
                  reasoning: 'no brain configured',
                  alternatives: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list agents');
    expect(result.entity_slug).toBe('aetherdesk');
    // No /reason call at all — straight to the local tier.
    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('11434');
  });

  it('falls through to the local tier when the brain is unreachable (fail-soft)', async () => {
    process.env.BRAIN_URL = 'http://localhost:3210';
    process.env.OPENCODE_API_KEY = 'test-key';

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/reason')) {
        throw new TypeError('fetch failed: brain down');
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'invoke_entity',
                  confidence: 0.95,
                  entity_slug: 'aetherdesk',
                  action: 'list_agents',
                  input: {},
                  reasoning: 'brain unreachable',
                  alternatives: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await routeTask('list agents');
    expect(result.entity_slug).toBe('aetherdesk');
    expect(fetchMock.mock.calls.length).toBe(2); // /reason (failed) + local
  });
});
