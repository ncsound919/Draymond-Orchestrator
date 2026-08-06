import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, fetchMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: execFileMock }));
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

  it('reports an abort/timeout as a timed-out failure', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
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
});

describe('invokeEntity dispatch', () => {
  it('throws for unsupported invocation methods', async () => {
    await expect(
      invokeEntity(entity({ invocation_method: 'not-real' }), 'x', {}),
    ).rejects.toThrow(/Unsupported invocation method/);
  });
});
