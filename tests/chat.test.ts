import { afterEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mutable fakes (reset per test) ──────────────────────────────────

const mocks = vi.hoisted(() => ({
  routeAndClassify: vi.fn(),
  invokeEntity: vi.fn(),
  instantiateChain: vi.fn(),
  executeChain: vi.fn(),
  getDashboardSummary: vi.fn(),
  dispatchTask: vi.fn(),
  getEntity: vi.fn(),
  logExecution: vi.fn().mockResolvedValue(undefined),
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
  submitAction: vi.fn(),
  getOperationRisk: vi.fn(),
  executeAetherDeskOperation: vi.fn(),
  resolveAetherDeskAgentId: vi.fn(),
  webSearch: vi.fn(),
  callLLM: vi.fn(),
  searchMemories: vi.fn().mockResolvedValue([]),
  enqueueWorkerTask: vi.fn().mockResolvedValue('task-abc'),
  getSystemIntel: vi.fn(),
  formatSystemIntel: vi.fn(),
  ingestTraceAsync: vi.fn(),
  probeAllServices: vi.fn(),
  auditApiKeys: vi.fn(),
  missingCriticalKeys: vi.fn(),
  getLessons: vi.fn(),
  recordOutcome: vi.fn().mockResolvedValue(undefined),
  listJobs: vi.fn(),
}));

vi.mock('../src/lib/draymond/router', () => ({
  routeAndClassify: mocks.routeAndClassify,
}));

vi.mock('../src/lib/draymond/invoker', () => ({
  invokeEntity: mocks.invokeEntity,
}));

vi.mock('../src/lib/draymond/chains', () => ({
  instantiateChain: mocks.instantiateChain,
  executeChain: mocks.executeChain,
}));

vi.mock('../src/lib/draymond/registry', () => ({
  getEntity: mocks.getEntity,
}));

vi.mock('../src/lib/draymond/confidence', () => ({
  logExecution: mocks.logExecution,
}));

vi.mock('../src/lib/draymond/index', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  submitAction: mocks.submitAction,
}));

vi.mock('../src/lib/draymond/aetherdesk', () => ({
  AETHERDESK_OPERATIONS: {
    list_agents: { method: 'GET', path: '/tenants/{tenant_id}/agents', risk: 'low' },
    launch_campaign: { method: 'POST', path: '/campaign/launch', risk: 'critical' },
  },
  getOperationRisk: mocks.getOperationRisk,
  executeAetherDeskOperation: mocks.executeAetherDeskOperation,
  resolveAetherDeskAgentId: mocks.resolveAetherDeskAgentId,
}));

vi.mock('@/lib/uplift', () => ({
  dispatchTask: mocks.dispatchTask,
}));

vi.mock('@/lib/agentbrowser', () => ({
  webSearch: mocks.webSearch,
}));

vi.mock('../src/lib/draymond/llm', () => ({
  callLLM: mocks.callLLM,
}));

vi.mock('../src/lib/draymond/memory-intelligence', () => ({
  searchMemories: mocks.searchMemories,
}));

vi.mock('../src/lib/draymond/worker-tasks', () => ({
  enqueueWorkerTask: mocks.enqueueWorkerTask,
}));

vi.mock('../src/lib/draymond/system-intel', () => ({
  getSystemIntel: mocks.getSystemIntel,
  formatSystemIntel: mocks.formatSystemIntel,
}));

vi.mock('../src/lib/draymond/service-manager', () => ({
  probeAllServices: mocks.probeAllServices,
}));

vi.mock('../src/lib/draymond/api-keys', () => ({
  auditApiKeys: mocks.auditApiKeys,
  missingCriticalKeys: mocks.missingCriticalKeys,
}));

vi.mock('../src/lib/draymond/self-learning', () => ({
  getLessons: mocks.getLessons,
  recordOutcome: mocks.recordOutcome,
}));

vi.mock('../src/lib/draymond/scheduler', () => ({
  listJobs: mocks.listJobs,
}));

vi.mock('../src/lib/draymond/trace', () => ({
  ingestTraceAsync: mocks.ingestTraceAsync,
}));

vi.mock('@/lib/audit', () => ({
  appendAuditLog: mocks.appendAuditLog,
}));

import { orchestrateChatTurn } from '../src/lib/draymond/chat';

// ── Helpers ─────────────────────────────────────────────────────────────────

function route(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'unknown',
    confidence: 0,
    entity_slug: undefined,
    chain_slug: undefined,
    action: undefined,
    input: undefined,
    reasoning: '',
    alternatives: [],
    resolved_at: new Date().toISOString(),
    latency_ms: 10,
    ...overrides,
  };
}

function classify(routeResult: Record<string, unknown>, opts: Partial<{ confirm: boolean }> = {}) {
  const confidence = routeResult.confidence as number;
  return {
    route: routeResult,
    should_auto_execute: confidence >= 0.85,
    needs_confirmation: opts.confirm ?? (confidence >= 0.4 && confidence < 0.85),
    needs_decomposition: routeResult.intent === 'decompose_goal',
  };
}

async function collectTurn(
  task: string,
  conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  metadata?: Record<string, unknown>,
) {
  const chunks: string[] = [];
  const result = await orchestrateChatTurn({
    task,
    conversation,
    metadata,
    onChunk: (c) => {
      chunks.push(c);
    },
  });
  return { result, chunks: chunks.join('') };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('orchestrateChatTurn', () => {
  it('returns an error result for an empty task', async () => {
    mocks.routeAndClassify.mockResolvedValue(classify(route()));
    const { result } = await collectTurn('   ');
    expect(result.status).toBe('error');
    expect(result.result).toContain('Please tell me');
    expect(mocks.routeAndClassify).not.toHaveBeenCalled();
  });

  it('auto-executes an entity when routing is high confidence', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'invoke_entity', confidence: 0.95, entity_slug: 'megacode', action: 'run', input: { prompt: 'hello' } })),
    );
    mocks.getEntity.mockResolvedValue({
      id: 'ent-1',
      slug: 'megacode',
      name: 'Megacode',
      kind: 'tool',
      invocation_method: 'http_api',
      invocation_config: { url: 'http://localhost:9000' },
      timeout_seconds: 30,
    });
    mocks.invokeEntity.mockResolvedValue({
      success: true,
      output: { text: 'hi from megacode' },
      duration_ms: 5,
    });

    const { result, chunks } = await collectTurn('use megacode to say hi');

    expect(result.entity_slug).toBe('megacode');
    expect(result.status).toBe('completed');
    expect(result.result).toContain('hi from megacode');
    expect(chunks).toContain('[invoke_entity');
    expect(mocks.invokeEntity).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'megacode' }),
      'run',
      { prompt: 'hello' },
    );
    expect(mocks.logExecution).toHaveBeenCalledWith(
      expect.objectContaining({ entity_slug: 'megacode', success: true }),
    );
  });

  it('reports a failed entity invocation without throwing', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'invoke_entity', confidence: 0.95, entity_slug: 'megacode', action: 'run' })),
    );
    mocks.getEntity.mockResolvedValue({
      id: 'ent-1',
      slug: 'megacode',
      name: 'Megacode',
      kind: 'tool',
      invocation_method: 'http_api',
      invocation_config: {},
      timeout_seconds: 30,
    });
    mocks.invokeEntity.mockResolvedValue({ success: false, output: {}, error: 'boom', duration_ms: 5 });

    const { result, chunks } = await collectTurn('use megacode');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('failed');
    expect(result.result).toContain('boom');
    expect(chunks).toContain('failed: boom');
  });

  it('runs low-risk AetherDesk operations immediately', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'invoke_entity', confidence: 0.95, entity_slug: 'aetherdesk', action: 'list_agents', input: { tenant_id: 'T1' } })),
    );
    mocks.getOperationRisk.mockReturnValue('low');
    mocks.executeAetherDeskOperation.mockResolvedValue({
      success: true,
      output: { agents: [{ id: 'a1' }] },
    });

    const { result } = await collectTurn('list agents for T1');

    expect(result.status).toBe('completed');
    expect(mocks.executeAetherDeskOperation).toHaveBeenCalledWith('list_agents', { tenant_id: 'T1' });
    expect(result.result).toContain('agents');
    expect(mocks.submitAction).not.toHaveBeenCalled();
  });

  it('queues high-risk AetherDesk operations for approval', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'invoke_entity', confidence: 0.95, entity_slug: 'aetherdesk', action: 'launch_campaign', input: { tenant_id: 'T1' } })),
    );
    mocks.getOperationRisk.mockReturnValue('critical');
    mocks.resolveAetherDeskAgentId.mockResolvedValue('agent-ad');
    mocks.submitAction.mockResolvedValue({ action: { id: 'action-1' }, decision: { action: 'queue_for_review' } });

    const { result, chunks } = await collectTurn('launch campaign T1');

    expect(result.status).toBe('completed');
    expect(chunks).toContain('queued for approval');
    expect(result.result).toContain('action-1');
    expect(mocks.submitAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: 'aetherdesk:launch_campaign', risk_level: 'critical' }),
    );
    expect(mocks.executeAetherDeskOperation).not.toHaveBeenCalled();
  });

  it('executes a chain when routing resolves a chain slug', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'execute_chain', confidence: 0.92, chain_slug: 'research-pipeline', input: { query: 'ai agents' } })),
    );
    mocks.instantiateChain.mockResolvedValue({ id: 'chain-1' });
    mocks.executeChain.mockResolvedValue({
      context: { done: true },
      steps: { s1: { status: 'completed', input: {}, output: {} } },
    });

    const { result, chunks } = await collectTurn('run the research pipeline');

    expect(result.chain_slug).toBe('research-pipeline');
    expect(result.status).toBe('completed');
    expect(result.result).toContain('chain-1');
    expect(chunks).toContain('[execute_chain');
    expect(mocks.instantiateChain).toHaveBeenCalledWith('research-pipeline', { query: 'ai agents' }, undefined, undefined);
  });

  it('returns needs_confirmation when confidence is mid-range', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'invoke_entity', confidence: 0.6, entity_slug: 'megacode' }), { confirm: true }),
    );

    const { result } = await collectTurn('do the thing');

    expect(result.status).toBe('needs_confirmation');
    expect(result.result).toContain('megacode');
    expect(result.result).toContain('confirm');
    expect(mocks.invokeEntity).not.toHaveBeenCalled();
  });

  it('falls back to the Uplift agent when the general chat path is unavailable', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1, reasoning: 'no clue' })),
    );
    mocks.callLLM.mockRejectedValue(new Error('no provider configured'));
    mocks.dispatchTask.mockResolvedValue({ content: 'uplift answered' });

    const { result, chunks } = await collectTurn('invent a new idea');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('uplift answered');
    expect(mocks.dispatchTask).toHaveBeenCalled();
    expect(chunks).toContain('[unknown');
  });

  it('hands Uplift timeouts back gracefully with diagnostics', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.dispatchTask.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    mocks.probeAllServices.mockResolvedValue([]);
    mocks.auditApiKeys.mockReturnValue({ checkedAt: 'x', configured: 0, missing: 0, noKey: 0, total: 0, items: [], missingNames: [] });
    mocks.missingCriticalKeys.mockReturnValue([]);
    mocks.getLessons.mockResolvedValue([]);
    mocks.listJobs.mockResolvedValue([]);
    mocks.callLLM.mockRejectedValue(new Error('llm down'));

    const { result } = await collectTurn('run something heavy');

    expect(result.result).toContain('not responding');
    expect(mocks.appendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'chat_uplift_error' }),
    );
  });

  it('passes the recent conversation into the router context', async () => {
    mocks.routeAndClassify.mockResolvedValue(classify(route({ intent: 'unknown', confidence: 0.2 })));
    mocks.dispatchTask.mockResolvedValue({ content: 'ok' });

    const conversation = [
      { role: 'user' as const, content: 'set up a monitor for example.com' },
      { role: 'assistant' as const, content: 'Done. Added site monitor.' },
    ];

    await collectTurn('check on it now', conversation);

    const [, context] = mocks.routeAndClassify.mock.calls[0];
    expect(context.conversation).toEqual(conversation);
  });

  it('answers deep system questions from the intelligence snapshot', async () => {
    mocks.routeAndClassify.mockResolvedValue(classify(route({ intent: 'query_status', confidence: 0.9 })));
    mocks.getSystemIntel.mockResolvedValue({ generated_at: '2026-08-07T00:00:00Z' });
    mocks.formatSystemIntel.mockReturnValue(
      '# Draymond system snapshot\n## Crons / scheduled jobs (3, 2 enabled)\nFailing: Market News Digest',
    );
    mocks.callLLM.mockResolvedValue(
      'Your crons: 3 scheduled, 2 enabled. Market News Digest is failing — I can dig into why.',
    );

    const { result, chunks } = await collectTurn('how are my crons doing?');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Market News Digest');
    expect(chunks).toContain('Gathering system state');
    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: expect.stringContaining('how are my crons doing?'),
      }),
    );
    expect(mocks.ingestTraceAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'chat_turn', metadata: expect.objectContaining({ intent: 'query_status' }) }),
    );
  });

  it('falls back to the raw snapshot when the LLM is unavailable', async () => {
    mocks.routeAndClassify.mockResolvedValue(classify(route({ intent: 'query_status', confidence: 0.9 })));
    mocks.getSystemIntel.mockResolvedValue({ generated_at: '2026-08-07T00:00:00Z' });
    mocks.formatSystemIntel.mockReturnValue('# Draymond system snapshot\n## Agents\nUplift Agent (active)');
    mocks.callLLM.mockRejectedValue(new Error('no model'));

    const { result } = await collectTurn('show system status');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Draymond system snapshot');
    expect(result.result).toContain('Uplift Agent');
  });

  it('reports gracefully when the system state cannot be read', async () => {
    mocks.routeAndClassify.mockResolvedValue(classify(route({ intent: 'query_status', confidence: 0.9 })));
    mocks.getSystemIntel.mockRejectedValue(new Error('db locked'));

    const { result } = await collectTurn('show system status');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Could not read system state');
  });

  it('performs a cited web search for web_search intent', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'web_search', confidence: 0.92, input: { query: 'react 19 features' } })),
    );
    mocks.webSearch.mockResolvedValue({
      query: 'react 19 features',
      results: [
        { title: 'React 19 Blog', url: 'https://react.dev/blog/2024/12/05/react-19' },
        { title: 'React Docs', url: 'https://react.dev/' },
      ],
      pages: [
        { url: 'https://react.dev/blog/2024/12/05/react-19', text: 'React 19 ships Actions, refs as props...' },
        { url: 'https://react.dev/', text: 'The library for web and native user interfaces...' },
      ],
    });
    mocks.callLLM.mockResolvedValue(
      'React 19 introduces Actions and refs as props [1]. It is the library for web and native UIs [2].',
    );

    const { result, chunks } = await collectTurn('search the web for react 19 features');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('[1]');
    expect(result.result).toContain('Sources');
    expect(result.result).toContain('https://react.dev/blog/2024/12/05/react-19');
    expect(chunks).toContain('[web_search');
    expect(mocks.webSearch).toHaveBeenCalledWith('react 19 features', { limit: 5, fetchPages: true });
  });

  it('falls back to raw results when web search returns nothing', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'web_search', confidence: 0.92, input: { query: 'no results' } })),
    );
    mocks.webSearch.mockResolvedValue({ query: 'no results', results: [], pages: [] });

    const { result } = await collectTurn('search the web for no results');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('No web results found');
    expect(mocks.callLLM).not.toHaveBeenCalled();
  });

  it('reports gracefully when AgentBrowser is unavailable', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'web_search', confidence: 0.92, input: { query: 'anything' } })),
    );
    mocks.webSearch.mockRejectedValue(new Error('AgentBrowser unreachable'));

    const { result } = await collectTurn('search the web for anything');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Web search unavailable');
  });

  it('answers small talk conversationally without dispatching an agent', async () => {
    const { result } = await collectTurn('yo');

    expect(result.status).toBe('completed');
    expect(mocks.routeAndClassify).not.toHaveBeenCalled();
    expect(mocks.dispatchTask).not.toHaveBeenCalled();
    expect(result.result).toMatch(/yo|what'?s up|hey/i);
  });

  it('routes a failure/downtime report through diagnostics + self-learning', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.probeAllServices.mockResolvedValue([
      { slug: 'bookbridge', name: 'BookBridge', url: 'http://localhost:8777/health', up: false, detail: 'fetch failed' },
      { slug: 'grader', name: 'Grader', url: 'http://localhost:3201/api/health', up: true, detail: 'HTTP 200' },
    ]);
    mocks.auditApiKeys.mockReturnValue({
      checkedAt: 'x', configured: 4, missing: 25, noKey: 10, total: 39,
      items: [], missingNames: ['Finnhub'],
    });
    mocks.missingCriticalKeys.mockReturnValue([{ name: 'Finnhub', envVars: ['FINNHUB_API_KEY'], engine: 'E1' }]);
    mocks.getLessons.mockResolvedValue([
      { id: 'l1', agentId: 'scheduler:Book', pattern: 'book scan', lesson: 'Repeated failure: book scan fetch failed', evidenceCount: 3, lastSeen: 'x' },
    ]);
    mocks.listJobs.mockResolvedValue([
      { name: 'Daily Book Library Scan', last_run_status: 'failed', last_error: 'fetch failed', cron_expression: '0 3 * * *', job_type: 'custom', job_config: {}, is_enabled: true, next_run_at: null, last_run_at: null, id: 'j1', run_count: 3, fail_count: 3, max_retries: 1, timeout_seconds: 300, notify_on_failure: true, notify_on_success: false, last_run_duration_ms: null, description: null, created_at: 'x', updated_at: 'x' },
    ]);
    mocks.callLLM.mockResolvedValue('Diagnostic summary');

    const { result, chunks } = await collectTurn('reporank is down and book scan is failing');

    expect(result.status).toBe('completed');
    expect(chunks).toContain('Running diagnostics');
    expect(result.result).toContain('Diagnostic summary');
    expect(mocks.probeAllServices).toHaveBeenCalled();
    expect(mocks.getLessons).toHaveBeenCalled();
  });

  it('feeds an uplift fallback failure into self-learning instead of a dead-end', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.dispatchTask.mockRejectedValue(new Error('uplift offline'));
    mocks.probeAllServices.mockResolvedValue([]);
    mocks.auditApiKeys.mockReturnValue({ checkedAt: 'x', configured: 0, missing: 0, noKey: 0, total: 0, items: [], missingNames: [] });
    mocks.missingCriticalKeys.mockReturnValue([]);
    mocks.getLessons.mockResolvedValue([]);
    mocks.listJobs.mockResolvedValue([]);
    mocks.callLLM.mockRejectedValue(new Error('llm down'));

    const { result } = await collectTurn('do something ambitious');

    expect(result.result).toContain('currently unavailable');
    expect(result.result).toContain('repair team');
    expect(mocks.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'chat:uplift', success: false }),
    );
  });

  it('answers unknown tasks conversationally through the general chat path', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1, reasoning: 'no match' })),
    );
    mocks.callLLM.mockResolvedValue('Here is a direct conversational answer.');

    const { result, chunks } = await collectTurn('Why is the sky blue?');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Here is a direct conversational answer.');
    expect(chunks).toContain('[unknown → general]');
    expect(mocks.dispatchTask).not.toHaveBeenCalled();
    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: expect.stringContaining('Why is the sky blue?') }),
    );
  });

  it('grounds general answers in the recent conversation (follow-ups)', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.2 })),
    );
    mocks.callLLM.mockResolvedValue('Answer about the monitor.');

    const conversation = [
      { role: 'user' as const, content: 'set up a monitor for example.com' },
      { role: 'assistant' as const, content: 'Done. Added the monitor.' },
    ];
    await collectTurn('what is its interval?', conversation);

    const userMessage = (mocks.callLLM.mock.calls[0][0] as { userMessage: string }).userMessage;
    expect(userMessage).toContain('set up a monitor for example.com');
    expect(userMessage).toContain('Done. Added the monitor.');
  });

  it('injects relevant long-term memory into the general answer', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.searchMemories.mockResolvedValue([
      {
        memory: {
          id: 'mem-1',
          key: 'preferred-crm',
          summary: 'User prefers CRM platform A',
          value: {},
          importance_score: 0.9,
        },
        relevance_score: 0.9,
        match_type: 'summary',
      },
    ]);
    mocks.callLLM.mockResolvedValue('Answer grounded in memory.');

    await collectTurn('what CRM should I use?', [], { user_id: 'u-1' });

    expect(mocks.searchMemories).toHaveBeenCalledWith(
      'draymond',
      'u-1',
      'what CRM should I use?',
      expect.objectContaining({ limit: 8 }),
    );
    const userMessage = (mocks.callLLM.mock.calls[0][0] as { userMessage: string }).userMessage;
    expect(userMessage).toContain('preferred-crm');
    expect(userMessage).toContain('User prefers CRM platform A');
  });

  it('passes attached images to the vision-capable LLM path', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.callLLM.mockResolvedValue('I can see a chart showing Q3 growth.');

    const { result, chunks } = await collectTurn(
      'what does this chart show?',
      [],
      { user_id: 'u-1', attachments: [{ mimeType: 'image/png', dataB64: 'aW1nZGF0YQ==' }] },
    );

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Q3 growth');
    expect(chunks).toContain('Looking at your image');
    expect(mocks.callLLM).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ dataB64: 'aW1nZGF0YQ==', mediaType: 'image/png' }],
      }),
    );
    expect(mocks.dispatchTask).not.toHaveBeenCalled();
  });

  it('compresses long conversations before answering', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.searchMemories.mockResolvedValue([]);
    mocks.callLLM.mockImplementation(async ({ system }: { system: string }) =>
      system.includes('conversation summarizer')
        ? 'earlier discussion about launch plans'
        : 'Final compressed answer',
    );

    const conversation = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i}`,
    }));

    const { result } = await collectTurn('summarize our work', conversation);

    expect(result.result).toContain('Final compressed answer');
    const userMessage = mocks.callLLM.mock.calls
      .map((c) => c[0] as { userMessage: string; system: string })
      .find((c) => c.system.includes('conversation summarizer'))?.userMessage;
    expect(userMessage).toBeDefined();
  });

  it('queues phone/device tasks to the Open-Chat worker', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.enqueueWorkerTask.mockResolvedValue('task-abc');

    const { result, chunks } = await collectTurn(
      'remind me to call the bank at 3pm',
      [],
      { user_id: 'u-1' },
    );

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Queued to your phone');
    expect(result.result).toContain('task-abc');
    expect(chunks).toContain('Queueing to your phone');
    expect(mocks.enqueueWorkerTask).toHaveBeenCalledWith(
      expect.objectContaining({
        skill_pack_id: 'on_device_ops:1.0.0',
        payload: expect.objectContaining({ request: 'remind me to call the bank at 3pm' }),
      }),
    );
    expect(mocks.dispatchTask).not.toHaveBeenCalled();
  });

  it('surfaces a worker-enqueue failure gracefully', async () => {
    mocks.routeAndClassify.mockResolvedValue(
      classify(route({ intent: 'unknown', confidence: 0.1 })),
    );
    mocks.enqueueWorkerTask.mockRejectedValue(new Error('queue is down'));

    const { result } = await collectTurn('take a screenshot on my phone');

    expect(result.status).toBe('completed');
    expect(result.result).toContain('Could not queue the on-device task');
    expect(result.result).toContain('queue is down');
  });
});
