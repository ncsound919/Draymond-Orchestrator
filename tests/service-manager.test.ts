import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { TOOL_PORTS } from '../src/lib/draymond/ports';
import {
  probeAllServices,
  probeService,
  restartService,
  serviceCatalog,
  serviceUrl,
  startDownServices,
  startService,
} from '../src/lib/draymond/service-manager';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFileSync: vi.fn() }));

const mockSpawn = vi.mocked(spawn);
const mockExecFileSync = vi.mocked(execFileSync);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-service-manager-'));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const mockChild = { unref: vi.fn() } as unknown as ChildProcess;

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  mockSpawn.mockReset().mockReturnValue(mockChild);
  mockExecFileSync.mockReset();
  delete process.env.MUTLY_URL;
  delete process.env.BRAIN_URL;
  delete process.env.OPENCODE_SERVE_PORT;
  delete process.env.DRAYMOND_PUBLIC_URL;
  // Point process.cwd() at the tmp dir so logPath + cwd resolution stay offline.
  vi.spyOn(process, 'cwd').mockReturnValue(tmp);
  fs.rmSync(path.join(tmp, 'data'), { recursive: true, force: true });
  fs.rmSync(path.join(tmp, 'agents'), { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('serviceCatalog', () => {
  it('lists every ported tool except the draymond control plane and stdio tools', () => {
    const catalog = serviceCatalog();
    const expected = TOOL_PORTS.filter((t) => t.port !== null && t.slug !== 'draymond');
    expect(catalog).toHaveLength(expected.length);
    expect(catalog.some((c) => c.slug === 'draymond')).toBe(false);
    expect(catalog.some((c) => c.slug === 'ufc-mcp')).toBe(false);
    expect(catalog.find((c) => c.slug === 'bookbridge')).toEqual({
      slug: 'bookbridge',
      name: 'BookBridge',
      port: 8777,
      health: '/health',
      env: 'BOOKBRIDGE_URL',
    });
  });
});

describe('serviceUrl', () => {
  it('builds a localhost URL from the canonical port + health path', () => {
    expect(serviceUrl('mutly')).toBe('http://localhost:4000/api/health');
    expect(serviceUrl('opencode')).toBe('http://localhost:4096/');
  });

  it('prefers a full-URL env override and strips trailing slashes', () => {
    process.env.MUTLY_URL = 'https://mutly.example.com/';
    expect(serviceUrl('mutly')).toBe('https://mutly.example.com/api/health');
  });

  it('ignores env vars that are bare port numbers', () => {
    process.env.OPENCODE_SERVE_PORT = '4096';
    expect(serviceUrl('opencode')).toBe('http://localhost:4096/');
  });

  it('returns null for unknown or stdio-only slugs', () => {
    expect(serviceUrl('nope')).toBeNull();
    expect(serviceUrl('ufc-mcp')).toBeNull();
  });
});

describe('probeService', () => {
  it('reports up for 2xx-4xx responses', async () => {
    const r = await probeService('mutly');
    expect(r).toMatchObject({ slug: 'mutly', name: 'Mutly', up: true, detail: 'HTTP 200', statusCode: 200 });
    expect(r.url).toBe('http://localhost:4000/api/health');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/api/health', expect.objectContaining({ redirect: 'manual' }));
  });

  it('treats 5xx as not healthy', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const r = await probeService('mutly');
    expect(r.up).toBe(false);
    expect(r.detail).toBe('HTTP 500 (not healthy)');
    expect(r.statusCode).toBe(500);
  });

  it('degrades to up=false with the error message when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await probeService('mutly');
    expect(r.up).toBe(false);
    expect(r.detail).toBe('ECONNREFUSED');
  });

  it('maps AbortError to a timeout detail', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(err);
    const r = await probeService('mutly', 4000);
    expect(r.up).toBe(false);
    expect(r.detail).toBe('timeout after 4000ms');
  });

  it('returns a no-url result for unknown slugs', async () => {
    const r = await probeService('nope');
    expect(r).toEqual({
      slug: 'nope',
      name: 'nope',
      url: null,
      up: false,
      detail: 'no canonical port/url for this service',
    });
  });

  it('POSTs a JSON-RPC initialize to /mcp endpoints', async () => {
    process.env.MUTLY_URL = 'https://mutly.example.com/mcp';
    const r = await probeService('mutly');
    expect(r.up).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mutly.example.com/mcp/api/health');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(init.body).toContain('"jsonrpc":"2.0"');
    expect(init.body).toContain('"method":"initialize"');
  });
});

describe('probeAllServices', () => {
  it('probes every catalogued service and returns their health', async () => {
    const results = await probeAllServices();
    expect(results).toHaveLength(serviceCatalog().length);
    expect(results.every((r) => r.up)).toBe(true);
    expect(results.find((r) => r.slug === 'bookbridge')?.url).toBe('http://localhost:8777/health');
    expect(fetchMock).toHaveBeenCalledTimes(serviceCatalog().length);
  });
});

describe('startService', () => {
  it('escalates when there is no start recipe', async () => {
    const r = await startService('nope');
    expect(r.up).toBe(false);
    expect(r.detail).toBe('no start recipe for "nope" — escalate');
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('escalates for known tools without a recipe, keeping the canonical name', async () => {
    const r = await startService('reporank');
    expect(r.name).toBe('RepoRank');
    expect(r.detail).toContain('no start recipe for "reporank" — escalate');
  });

  it('short-circuits when the service is already healthy', async () => {
    const r = await startService('bookbridge');
    expect(r).toMatchObject({ slug: 'bookbridge', up: true });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('fails fast when the working dir is missing', async () => {
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 500 }));
    const r = await startService('bookbridge');
    expect(r.up).toBe(false);
    expect(r.detail).toContain('working dir missing');
    expect(r.detail).toContain(path.join(tmp, 'agents', 'BookBridge--main'));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns the recipe, waits for health, and returns up', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.useFakeTimers();
    const pending = startService('bookbridge');
    await vi.advanceTimersByTimeAsync(12 * 1500);
    const r = await pending;
    expect(r.up).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0]!;
    expect(cmd).toBe(process.platform === 'win32' ? 'cmd.exe' : 'python');
    expect(args.join(' ')).toContain('main.py');
    expect(opts).toMatchObject({
      cwd: path.join(tmp, 'agents', 'BookBridge--main'),
      detached: true,
      stdio: 'ignore',
    });
    expect(mockChild.unref).toHaveBeenCalled();
    const log = fs.readFileSync(path.join(tmp, 'data', 'server-logs', 'bookbridge.out.log'), 'utf-8');
    expect(log).toContain('started bookbridge');
  });

  it('returns a failing health detail when the service never comes up', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 500 }));
    vi.useFakeTimers();
    const pending = startService('bookbridge');
    await vi.advanceTimersByTimeAsync(12 * 1500);
    const r = await pending;
    expect(r.up).toBe(false);
    expect(r.detail).toContain('but health check still failing');
    expect(r.detail).toContain('HTTP 500 (not healthy)');
    expect(fetchMock).toHaveBeenCalledTimes(14); // pre-probe + 12 loop probes + final probe
  });

  it('resolves the working dir to the repo root when no override or tool cwd exists', async () => {
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 500 }));
    // The uplift-agent override points at agents/Uplift-Agent; give the temp
    // root that checkout so the recipe's working dir resolves instead of
    // "missing".
    fs.mkdirSync(path.join(tmp, 'agents', 'Uplift-Agent'), { recursive: true });
    vi.useFakeTimers();
    const pending = startService('uplift-agent');
    await vi.advanceTimersByTimeAsync(12 * 1500);
    const r = await pending;
    expect(r.url).toBe('http://localhost:8000/health'); // uplift-agent is in TOOL_PORTS
    expect(r.detail).toContain('started "node agents/Uplift-Agent/server.js"');
    const opts = mockSpawn.mock.calls[0]![2] as { cwd?: string };
    expect(opts.cwd).toBe(path.join(tmp, 'agents', 'Uplift-Agent'));
  });
});

describe('restartService', () => {
  it('kills on win32 (pkill elsewhere) then starts the service', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    mockExecFileSync.mockReturnValue(Buffer.from('killed'));
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.useFakeTimers();
    const pending = restartService('bookbridge');
    await vi.advanceTimersByTimeAsync(800 + 1500);
    const r = await pending;
    expect(r.up).toBe(true);
    if (process.platform === 'win32') {
      expect(mockExecFileSync).toHaveBeenCalledWith('taskkill', ['/F', '/IM', 'node.exe'], expect.objectContaining({ timeout: 5000 }));
    } else {
      expect(mockExecFileSync).toHaveBeenCalledWith('pkill', ['-f', 'bookbridge'], expect.objectContaining({ timeout: 5000 }));
    }
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('continues to start even when the kill fails', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    mockExecFileSync.mockImplementation(() => {
      throw new Error('access denied');
    });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.useFakeTimers();
    const pending = restartService('bookbridge');
    await vi.advanceTimersByTimeAsync(800 + 1500);
    const r = await pending;
    expect(r.up).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('uses pkill on non-win32 platforms', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      mockExecFileSync.mockReturnValue(Buffer.from('killed'));
      fetchMock
        .mockReset()
        .mockResolvedValueOnce(new Response('{}', { status: 500 }))
        .mockResolvedValue(new Response('{}', { status: 200 }));
      vi.useFakeTimers();
      const pending = restartService('bookbridge');
      await vi.advanceTimersByTimeAsync(800 + 1500);
      const r = await pending;
      expect(r.up).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledWith('pkill', ['-f', 'bookbridge'], expect.objectContaining({ timeout: 5000 }));
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });
});

describe('startDownServices', () => {
  it('keeps healthy services as-is and starts only the down ones', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // mutly probe → up
      .mockResolvedValueOnce(new Response('{}', { status: 500 })) // bookbridge probe → down
      .mockResolvedValueOnce(new Response('{}', { status: 500 })) // pre-spawn probe → still down
      .mockResolvedValue(new Response('{}', { status: 200 })); // post-spawn probe → up
    vi.useFakeTimers();
    const pending = startDownServices(['mutly', 'bookbridge']);
    await vi.advanceTimersByTimeAsync(12 * 1500);
    const results = await pending;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ slug: 'mutly', up: true });
    expect(results[1]).toMatchObject({ slug: 'bookbridge', up: true });
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('reports down services that fail to start', async () => {
    fs.mkdirSync(path.join(tmp, 'agents', 'BookBridge--main'), { recursive: true });
    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 500 }));
    vi.useFakeTimers();
    const pending = startDownServices(['bookbridge']);
    await vi.advanceTimersByTimeAsync(12 * 1500);
    const [r] = await pending;
    expect(r).toMatchObject({ slug: 'bookbridge', up: false });
    expect(r.detail).toContain('health check still failing');
  });
});
