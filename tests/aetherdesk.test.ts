import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AETHERDESK_DEFAULT_BASE_URL,
  AETHERDESK_OPERATIONS,
  buildAetherDeskUrl,
  executeAetherDeskOperation,
  getOperationRisk,
  normalizeAetherDeskBaseUrl,
  resolveAetherDeskBaseUrl,
} from '../src/lib/draymond/aetherdesk';

describe('normalizeAetherDeskBaseUrl', () => {
  it('defaults to the pm2 port when nothing is configured', () => {
    expect(AETHERDESK_DEFAULT_BASE_URL).toBe('http://127.0.0.1:8002/api/v1');
    expect(normalizeAetherDeskBaseUrl(undefined)).toBe(AETHERDESK_DEFAULT_BASE_URL);
    expect(normalizeAetherDeskBaseUrl('')).toBe(AETHERDESK_DEFAULT_BASE_URL);
  });

  it('appends /api/v1 to a bare origin', () => {
    expect(normalizeAetherDeskBaseUrl('http://127.0.0.1:8002')).toBe('http://127.0.0.1:8002/api/v1');
  });

  it('never doubles /api/v1', () => {
    expect(normalizeAetherDeskBaseUrl('http://127.0.0.1:8002/api/v1')).toBe('http://127.0.0.1:8002/api/v1');
    expect(normalizeAetherDeskBaseUrl('http://127.0.0.1:8002/api/v1/')).toBe('http://127.0.0.1:8002/api/v1');
  });

  it('adds a missing scheme and strips trailing slashes', () => {
    expect(normalizeAetherDeskBaseUrl('127.0.0.1:8002//')).toBe('http://127.0.0.1:8002/api/v1');
    expect(normalizeAetherDeskBaseUrl('https://aether.example.com')).toBe('https://aether.example.com/api/v1');
  });
});

describe('resolveAetherDeskBaseUrl', () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const k of ['AETHERDESK_BASE_URL', 'AETHERDESK_API_URL']) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('prefers AETHERDESK_BASE_URL', () => {
    process.env.AETHERDESK_BASE_URL = 'http://127.0.0.1:8002/api/v1';
    process.env.AETHERDESK_API_URL = 'http://elsewhere:9999/api/v1';
    expect(resolveAetherDeskBaseUrl()).toBe('http://127.0.0.1:8002/api/v1');
  });

  it('falls back to AETHERDESK_API_URL, the name .env.local actually uses', () => {
    delete process.env.AETHERDESK_BASE_URL;
    process.env.AETHERDESK_API_URL = 'http://127.0.0.1:8002/api/v1';
    expect(resolveAetherDeskBaseUrl()).toBe('http://127.0.0.1:8002/api/v1');
  });

  it('still resolves when neither var is set', () => {
    delete process.env.AETHERDESK_BASE_URL;
    delete process.env.AETHERDESK_API_URL;
    expect(resolveAetherDeskBaseUrl()).toBe(AETHERDESK_DEFAULT_BASE_URL);
  });
});

describe('AETHERDESK_OPERATIONS catalog', () => {
  it('defines all 17 catalog operations', () => {
    expect(Object.keys(AETHERDESK_OPERATIONS).sort()).toEqual([
      'call_action', 'clone_voice', 'create_agent', 'create_campaign', 'delete_agent',
      'get_agent', 'get_call', 'get_campaign', 'health',
      'launch_campaign', 'list_agents', 'list_calls', 'list_campaigns',
      'list_leads', 'start_call', 'update_agent',
      'update_campaign',
    ].sort());
  });

  it('assigns every operation a valid risk level', () => {
    const risks = new Set(['low', 'medium', 'high', 'critical']);
    for (const def of Object.values(AETHERDESK_OPERATIONS)) {
      expect(risks.has(def.risk)).toBe(true);
    }
  });

  it('marks high/critical operations that must be gated', () => {
    const gated = Object.entries(AETHERDESK_OPERATIONS)
      .filter(([, def]) => def.risk === 'high' || def.risk === 'critical')
      .map(([name]) => name)
      .sort();
    expect(gated).toEqual([
      'create_agent', 'create_campaign', 'delete_agent', 'launch_campaign',
      'start_call', 'update_agent', 'update_campaign',
    ].sort());
  });
});

describe('getOperationRisk', () => {
  it('returns risk for known operations', () => {
    expect(getOperationRisk('launch_campaign')).toBe('critical');
    expect(getOperationRisk('list_agents')).toBe('low');
    expect(getOperationRisk('call_action')).toBe('medium');
  });

  it('returns null for unknown operations', () => {
    expect(getOperationRisk('pause_campaign')).toBeNull();
    expect(getOperationRisk('set_agent_status')).toBeNull();
    expect(getOperationRisk('')).toBeNull();
  });
});

describe('buildAetherDeskUrl', () => {
  const BASE = 'http://127.0.0.1:8000/api/v1';

  it('substitutes {tenant_id} into the path', () => {
    const { url, body } = buildAetherDeskUrl(BASE, 'list_agents', {}, 'TENANT-001');
    expect(url).toBe('http://127.0.0.1:8000/api/v1/tenants/TENANT-001/agents');
    expect(body).toBeNull(); // GET has no body
  });

  it('consumes {agent_id} placeholder from input', () => {
    const { url, body } = buildAetherDeskUrl(BASE, 'get_agent', { agent_id: 'AG-1' }, 'TENANT-001');
    expect(url).toBe('http://127.0.0.1:8000/api/v1/tenants/TENANT-001/agents/AG-1');
    expect(body).toBeNull(); // GET has no body, placeholder removed
  });

  it('appends tenant_id query param for calls routes', () => {
    const { url } = buildAetherDeskUrl(BASE, 'list_calls', {}, 'TENANT-001');
    expect(url).toBe('http://127.0.0.1:8000/api/v1/calls?tenant_id=TENANT-001');
  });

  it('keeps POST body for create operations', () => {
    const { url, body } = buildAetherDeskUrl(
      BASE,
      'create_campaign',
      { company_name: 'Acme', phone: '+1000', leads: [{ name: 'A', phone: '+1' }] },
      'TENANT-001',
    );
    expect(url).toBe('http://127.0.0.1:8000/api/v1/campaign/campaigns');
    expect(body).toEqual({ company_name: 'Acme', phone: '+1000', leads: [{ name: 'A', phone: '+1' }] });
  });

  it('deletes payload body for DELETE operations', () => {
    const { url, body } = buildAetherDeskUrl(BASE, 'delete_agent', { agent_id: 'AG-9' }, 'TENANT-001');
    expect(url).toBe('http://127.0.0.1:8000/api/v1/tenants/TENANT-001/agents/AG-9');
    expect(body).toBeNull();
  });

  it('throws when a required placeholder is missing from input', () => {
    expect(() => buildAetherDeskUrl(BASE, 'get_call', {}, 'TENANT-001')).toThrow(/call_id/);
  });

  it('strips trailing slash from base URL', () => {
    const { url } = buildAetherDeskUrl('http://127.0.0.1:8000/api/v1/', 'health', {}, 'TENANT-001');
    expect(url).toBe('http://127.0.0.1:8000/api/v1/health');
  });
});

describe('executeAetherDeskOperation', () => {
  const BASE = 'http://127.0.0.1:8000/api/v1';
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    process.env.AETHERDESK_BASE_URL = BASE;
    process.env.AETHERDESK_API_KEY = 'dev-api-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AETHERDESK_BASE_URL;
    delete process.env.AETHERDESK_API_KEY;
    fetchMock.mockReset();
  });

  it('returns success with parsed JSON output on 2xx', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ total_agents: 3 }), { status: 200 }),
    );
    const result = await executeAetherDeskOperation('list_agents', {}, { tenantId: 'TENANT-001' });
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ total_agents: 3 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${BASE}/tenants/TENANT-001/agents`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('dev-api-key');
  });

  it('returns error result on HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }));
    const result = await executeAetherDeskOperation('health', {});
    expect(result.success).toBe(false);
    expect(result.status_code).toBe(503);
    expect(result.error).toContain('HTTP 503');
  });

  it('returns error result for unknown operations without calling fetch', async () => {
    const result = await executeAetherDeskOperation('pause_campaign', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown AetherDesk operation');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error result when env vars are missing', async () => {
    delete process.env.AETHERDESK_BASE_URL;
    delete process.env.AETHERDESK_API_KEY;
    const result = await executeAetherDeskOperation('health', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('returns timeout error on AbortError', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));
    const result = await executeAetherDeskOperation('health', {}, { timeoutMs: 50 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('POSTs input as JSON body for mutating operations', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'CAM-1' }), { status: 201 }),
    );
    const result = await executeAetherDeskOperation(
      'create_campaign',
      { company_name: 'Acme', phone: '+1000' },
      { tenantId: 'TENANT-001' },
    );
    expect(result.success).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ company_name: 'Acme', phone: '+1000' });
  });
});
