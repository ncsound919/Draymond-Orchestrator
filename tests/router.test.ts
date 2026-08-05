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
});
