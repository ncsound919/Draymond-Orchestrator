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
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
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

  it('calls the OpenCode Zen free endpoint with Bearer auth', async () => {
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
                  reasoning: 'call center task',
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

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('deepseek-v4-flash-free');
    // structured output (the outlines analog) for deterministic intent JSON
    expect(body.response_format).toEqual({ type: 'json_object' });
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
});
