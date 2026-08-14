import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, fetchMock, execFileSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  fetchMock: vi.fn(),
  execFileSyncMock: vi.fn<(cmd: string) => unknown>(() => {
    throw new Error('ENOENT'); // default: binary not found
  }),
}));

vi.mock('node:child_process', () => ({ execFile: execFileMock, execFileSync: execFileSyncMock }));
vi.stubGlobal('fetch', fetchMock);

import { invokeEntity } from '../src/lib/draymond/invoker';
import type { EntityForInvocation } from '../src/lib/draymond/invoker';

function entity(overrides: Partial<EntityForInvocation> = {}): EntityForInvocation {
  return {
    id: 'e1',
    name: 'Test',
    slug: 'test',
    kind: 'agent',
    invocation_method: 'http_api',
    invocation_config: {},
    timeout_seconds: 30,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete process.env.ALLOW_LOCAL_AGENTS;
  fetchMock.mockReset();
  execFileMock.mockReset();
  execFileSyncMock.mockReset();
});

describe('invokeEntity http_api', () => {
  it('POSTs { action, ...input } and returns parsed JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: 1 }));
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'https://api.example.com/invoke' } }),
      'run',
      { a: 1 },
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ ok: true, data: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.example.com/invoke');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'run', a: 1 });
  });

  it('returns a failed result on HTTP error status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 500));
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'https://api.example.com/invoke' } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTP 500/);
  });

  it('blocks private URLs when in production and local agents disallowed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ALLOW_LOCAL_AGENTS;
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'http://127.0.0.1:3000/invoke' } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SSRF blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a localhost URL in production when on LOCAL_SERVICE_ALLOWLIST', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ALLOW_LOCAL_AGENTS;
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', 'localhost,127.0.0.1');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'http://127.0.0.1:8000/invoke' } }),
      'run',
      {},
    );
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('still blocks localhost in production when the allowlist omits it', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.ALLOW_LOCAL_AGENTS;
    vi.stubEnv('LOCAL_SERVICE_ALLOWLIST', 'services.internal');
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'http://127.0.0.1:3000/invoke' } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SSRF blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an abort/timeout as a timed-out failure', async () => {
    const err = new Error('aborted');    err.name = 'AbortError';
    fetchMock.mockRejectedValue(err);
    const result = await invokeEntity(
      entity({ invocation_config: { url: 'https://api.example.com/invoke' } }),
      'run',
      {},
      { timeout_ms: 10 },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out|abort/i);
  });

  it('routes to an endpoint path from the endpoints map with :param substitution', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await invokeEntity(
      entity({
        invocation_config: {
          url: 'http://localhost:4000',
          endpoints: {
            pipeline_status: { path: '/api/pipeline/status/:pipelineId', method: 'GET' },
            analyze: { path: '/api/agent/analyze', method: 'POST' },
          },
        },
      }),
      'pipeline_status',
      { pipelineId: 'p-1', tag: 'x' },
    );
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    // :param consumed from input and carried as a query param on GET
    expect(String(url)).toBe('http://localhost:4000/api/pipeline/status/p-1?tag=x');
    expect(init.method).toBe('GET');
  });

  it('POSTs endpoint actions with remaining input as the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await invokeEntity(
      entity({
        invocation_config: {
          url: 'http://localhost:4000',
          endpoints: { analyze: { path: '/api/agent/analyze', method: 'POST' } },
        },
      }),
      'analyze',
      { query: 'vector search' },
    );
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:4000/api/agent/analyze');
    expect(JSON.parse(init.body as string)).toEqual({ action: 'analyze', query: 'vector search' });
  });

  it('falls back to the base url when the action has no endpoint entry', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await invokeEntity(
      entity({
        invocation_config: { url: 'https://api.example.com/invoke', endpoints: { a: { path: '/a' } } },
      }),
      'nope',
      { x: 1 },
    );
    expect(result.success).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/invoke');
  });
});

describe('invokeEntity api_call', () => {
  it('always POSTs wrapped { action, input }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const result = await invokeEntity(
      entity({ invocation_method: 'api_call', invocation_config: { url: 'https://x.com/call' } }),
      'go',
      { z: 9 },
    );
    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ action: 'go', input: { z: 9 } });
  });
});

describe('invokeEntity subprocess / cli_command', () => {
  it('rejects commands outside the allowlist', async () => {
    const result = await invokeEntity(
      entity({ invocation_method: 'subprocess', invocation_config: { command: 'rm' } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in the allowed command list/);
  });

  it('runs an allowed command and parses JSON stdout', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '{"ok":true}', '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'subprocess', invocation_config: { command: 'node', args: ['x.js'] } }),
      'run',
      { n: 1 },
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ ok: true });
  });

  it('surfaces process errors from subprocess', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(new Error('boom'), '', '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'subprocess', invocation_config: { command: 'node', args: ['x.js'] } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  it('blocks dangerous subprocess args', async () => {
    const result = await invokeEntity(
      entity({ invocation_method: 'subprocess', invocation_config: { command: 'node', args: ['--eval', 'x'] } }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked argument pattern/);
  });

  it('cli_command runs an allowlisted command with ENTITY_INPUT', async () => {
    execFileMock.mockImplementation((_cmd, _args, opts, cb) => {
      expect(opts.env.ENTITY_INPUT).toBe(JSON.stringify({ n: 2 }));
      cb(null, '{"done":true}', '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'cli_command', invocation_config: { command: 'python script.py' } }),
      'run',
      { n: 2 },
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ done: true });
  });

  it('cli_command blocks dangerous args (e.g. --eval) to prevent code execution', async () => {
    const result = await invokeEntity(
      entity({
        invocation_method: 'cli_command',
        invocation_config: { command: "node --eval process.exit()" },
      }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Blocked dangerous argument/);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe('invokeEntity webhook / internal / manual / python_module', () => {
  it('webhook returns accepted marker on 2xx', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 202));
    const result = await invokeEntity(
      entity({ invocation_method: 'webhook', invocation_config: { url: 'https://hooks.example.com/x' } }),
      'ping',
      {},
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ accepted: true, status: 202 });
  });

  it('internal returns a status marker', async () => {
    const result = await invokeEntity(entity({ invocation_method: 'internal' }), 'x', {});
    expect(result.success).toBe(true);
    expect(result.output.status).toBe('internal');
  });

  it('open-chat-worker enqueue_capture queues a marketing worker task', async () => {
    vi.doMock('../src/lib/draymond/worker-tasks', () => ({
      enqueueWorkerTask: async () => 'task-1',
    }));
    // Re-import the invoker so the mocked worker-tasks module is used.
    const mod = await import('../src/lib/draymond/invoker');
    const result = await mod.invokeEntity(
      entity({ slug: 'open-chat-worker', invocation_method: 'internal' }),
      'enqueue_capture',
      { app: 'instagram', prompt: 'capture reels' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ queued: true, skill_pack_id: 'marketing_capture:1.0.0' });
    expect(result.output.task_id).toBe('task-1');
  });

  it('manual returns a manual_required marker', async () => {
    const result = await invokeEntity(entity({ invocation_method: 'manual' }), 'x', {});
    expect(result.success).toBe(true);
    expect(result.output.status).toBe('manual_required');
  });

  it('python_module rejects invalid module names', async () => {
    const result = await invokeEntity(
      entity({ invocation_method: 'python_module', invocation_config: { module: 'bad!name', function: 'f' } }),
      'x',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid Python module name/);
  });

  it('python_module honors working_dir and python_path', async () => {
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      expect(cmd).toBe('python3');
      expect(opts.cwd).toBe('./agents/TradingAgents-main');
      cb(null, '{"echo":"hello"}', '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({
        invocation_method: 'python_module',
        invocation_config: {
          module: 'main',
          function: 'main',
          working_dir: './agents/TradingAgents-main',
          python_path: 'python3',
        },
      }),
      'x',
      { v: 'hello' },
    );
    expect(result.success).toBe(true);
    expect(result.output.echo).toBe('hello');
  });
});

describe('invokeEntity mcp_tool / mcp_stdio', () => {
  it('mcp_tool posts to /mcp/tools/:name and parses the response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [{ text: 'hi' }] }));
    const result = await invokeEntity(
      entity({ invocation_method: 'mcp_tool', invocation_config: { server_url: 'https://mcp.example.com', tool_name: 'summarize' } }),
      'x',
      { t: 'text' },
    );
    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://mcp.example.com/mcp/tools/summarize');
    expect(JSON.parse(init.body as string)).toEqual({ input: { t: 'text' } });
  });

  it('mcp_stdio parses a JSON-RPC tools/call response', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }), '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'mcp_stdio', invocation_config: { command: 'node', args: ['mcp.js'], tool_name: 't' } }),
      'x',
      { a: 1 },
    );
    expect(result.success).toBe(true);
    expect(result.output.content).toBeTruthy();
  });

  it('mcp_stdio reports empty stdout as a protocol failure', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '', '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'mcp_stdio', invocation_config: { command: 'node', args: ['mcp.js'], tool_name: 't' } }),
      'x',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty stdout/);
  });

  it('mcp_stdio sends the initialize handshake + tools/call and matches by id', async () => {
    const written: string[] = [];
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const handshake = { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2024-11-05' } };
      const call = { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'done' }] } };
      cb(null, `${JSON.stringify(handshake)}\n${JSON.stringify(call)}`, '');
      return { stdin: { write: (s: string) => written.push(s), end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'mcp_stdio', invocation_config: { command: 'node', args: ['mcp.js'] } }),
      'convert_document',
      { from: 'md', to: 'json' },
    );
    expect(result.success).toBe(true);
    expect(result.output.content).toBeTruthy();
    // Three JSON-RPC messages were written to stdin
    const messages = written.join('').trim().split('\n').map((l) => JSON.parse(l));
    expect(messages[0].method).toBe('initialize');
    expect(messages[1].method).toBe('notifications/initialized');
    expect(messages[2].method).toBe('tools/call');
    // action became the MCP tool name
    expect(messages[2].params.name).toBe('convert_document');
    expect(messages[2].params.arguments).toEqual({ from: 'md', to: 'json' });
  });

  it('mcp_stdio uses config.tool_name over the action when both are present', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }), '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'mcp_stdio', invocation_config: { command: 'node', args: ['mcp.js'], tool_name: 'fixed_tool' } }),
      'whatever',
      {},
    );
    expect(result.success).toBe(true);
  });

  it('mcp_stdio passes cwd through to the spawned process', async () => {
    const capturedOptions: Array<{ cwd?: string }> = [];
    execFileMock.mockImplementation((_cmd, _args, o, cb) => {
      capturedOptions.push(o as { cwd?: string });
      cb(null, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }), '');
      return { stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({
        invocation_method: 'mcp_stdio',
        invocation_config: { command: 'node', args: ['dist/index.js'], cwd: 'agents/UFC-MCP-main' },
      }),
      'get_supported_formats',
      {},
    );
    expect(result.success).toBe(true);
    expect(capturedOptions[0]?.cwd).toBe('agents/UFC-MCP-main');
  });
});

describe('invokeEntity dispatch', () => {
  it('throws for unsupported invocation methods', async () => {
    await expect(
      invokeEntity(entity({ invocation_method: 'not-real' }), 'x', {}),
    ).rejects.toThrow(/Unsupported invocation method/);
  });
});

describe('cli_command requires gating (Step 9)', () => {
  it('fails closed when a declared required binary is missing', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = await invokeEntity(
      entity({
        invocation_method: 'cli_command',
        invocation_config: { command: 'node script.js', requires: ['a-binary-that-does-not-exist-xyz'] },
      }),
      'run',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Required binary "a-binary-that-does-not-exist-xyz" not found/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('passes through when no requires are declared (backward compatible)', async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '{}', '');
      return { on: () => {}, stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({ invocation_method: 'cli_command', invocation_config: { command: 'node script.js' } }),
      'run',
      {},
    );
    expect(result.success).toBe(true);
  });

  it('allows dispatch when the required binary resolves', async () => {
    execFileSyncMock.mockImplementation(() => undefined); // `where node` succeeds
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '{}', '');
      return { on: () => {}, stdin: { write: () => {}, end: () => {} } };
    });
    const result = await invokeEntity(
      entity({
        invocation_method: 'cli_command',
        invocation_config: { command: 'node script.js', requires: ['node'] },
      }),
      'run',
      {},
    );
    expect(result.success).toBe(true);
  });
});
