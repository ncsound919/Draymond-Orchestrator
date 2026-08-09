import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RegisteredAgent } from '../src/lib/registry/types';
import type { ServiceHealth } from '../src/lib/draymond/service-manager';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draymond-heartbeat-'));

vi.mock('../src/lib/draymond/service-manager', () => ({ probeAllServices: vi.fn() }));
vi.mock('@/lib/registry/agent-store', () => ({ getAllAgents: vi.fn(), updateAgentStatus: vi.fn() }));

// heartbeat.ts resolves DRAYMOND_REGISTRY_DIR at module load, so the env var
// must be set before the module is imported — dynamic imports in beforeEach.
let heartbeat: typeof import('../src/lib/draymond/heartbeat');
let serviceManager: { probeAllServices: Mock };
let agentStore: { getAllAgents: Mock; updateAgentStatus: Mock };

const HEARTBEAT_FILE = path.join(tmp, 'heartbeats.json');

const agent = (slug: string, name = slug, id = slug): RegisteredAgent =>
  ({ id, slug, name }) as unknown as RegisteredAgent;

const svc = (slug: string, up: boolean): ServiceHealth => ({
  slug,
  name: slug,
  url: `http://localhost:${slug}`,
  up,
  detail: up ? 'HTTP 200' : 'HTTP 500 (not healthy)',
  statusCode: up ? 200 : 500,
});

beforeEach(async () => {
  process.env.DRAYMOND_REGISTRY_DIR = tmp;
  vi.resetModules();
  heartbeat = await import('../src/lib/draymond/heartbeat');
  serviceManager = (await import('../src/lib/draymond/service-manager')) as unknown as { probeAllServices: Mock };
  agentStore = (await import('@/lib/registry/agent-store')) as unknown as { getAllAgents: Mock; updateAgentStatus: Mock };
  serviceManager.probeAllServices.mockReset().mockResolvedValue([]);
  agentStore.getAllAgents.mockReset().mockResolvedValue([]);
  agentStore.updateAgentStatus.mockReset().mockResolvedValue(undefined);
  fs.rmSync(HEARTBEAT_FILE, { force: true });
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('runHeartbeatSweep', () => {
  it('records heartbeats, updates roster statuses, and reports up/down counts', async () => {
    agentStore.getAllAgents.mockResolvedValue([
      agent('uplift-agent', 'Uplift Agent'),
      agent('sports-steve', 'Sports Steve'),
      agent('kaggle', 'Kaggle'),
      agent('bookbridge', 'BookBridge'),
    ]);
    serviceManager.probeAllServices.mockResolvedValue([
      svc('uplift', true),
      svc('sports-steve', false),
      svc('deterministic-brain', true),
      svc('bookbridge', true),
      svc('unrelated', true),
    ]);

    const r = await heartbeat.runHeartbeatSweep();
    expect(r).toEqual({ checked: 5, up: 4, down: ['sports-steve'], recorded: 4 });

    // slug mapping: uplift-agent→uplift, kaggle→deterministic-brain, others pass through
    expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('uplift-agent', 'online');
    expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('sports-steve', 'offline');
    expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('kaggle', 'online');
    expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('bookbridge', 'online');

    const beats = await heartbeat.getHeartbeats();
    expect(Object.keys(beats)).toHaveLength(4);
    expect(beats['uplift-agent']).toMatchObject({
      slug: 'uplift-agent',
      name: 'Uplift Agent',
      up: true,
      detail: 'HTTP 200',
    });
    expect(beats['uplift-agent']!.last_seen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(beats['sports-steve']!.up).toBe(false);
    expect(fs.existsSync(HEARTBEAT_FILE)).toBe(true);
  });

  it('skips agents that have no canonical service probe', async () => {
    agentStore.getAllAgents.mockResolvedValue([agent('mystery-agent', 'Mystery')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('uplift', true)]);
    const r = await heartbeat.runHeartbeatSweep();
    expect(r.recorded).toBe(0);
    expect(agentStore.updateAgentStatus).not.toHaveBeenCalled();
    expect(await heartbeat.getHeartbeats()).toEqual({});
  });

  it('fails open when the agent store read rejects', async () => {
    agentStore.getAllAgents.mockRejectedValue(new Error('registry corrupt'));
    serviceManager.probeAllServices.mockResolvedValue([svc('uplift', true)]);
    const r = await heartbeat.runHeartbeatSweep();
    expect(r).toEqual({ checked: 1, up: 1, down: [], recorded: 0 });
    expect(await heartbeat.getHeartbeats()).toEqual({});
  });

  it('fails open when the probe sweep rejects', async () => {
    agentStore.getAllAgents.mockResolvedValue([agent('uplift-agent', 'Uplift')]);
    serviceManager.probeAllServices.mockRejectedValue(new Error('probe exploded'));
    const r = await heartbeat.runHeartbeatSweep();
    expect(r).toEqual({ checked: 0, up: 0, down: [], recorded: 0 });
  });

  it('tolerates status update failures but still records the beat', async () => {
    agentStore.getAllAgents.mockResolvedValue([agent('uplift-agent', 'Uplift')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('uplift', true)]);
    agentStore.updateAgentStatus.mockRejectedValue(new Error('disk full'));
    const r = await heartbeat.runHeartbeatSweep();
    expect(r.recorded).toBe(1);
    expect(await heartbeat.getHeartbeats()).toHaveProperty('uplift-agent');
  });

  it('preserves existing heartbeats and merges new ones', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        'old-agent': { slug: 'old-agent', name: 'Old', last_seen: '2026-01-01T00:00:00.000Z', up: true, detail: 'old' },
      }),
    );
    agentStore.getAllAgents.mockResolvedValue([agent('uplift-agent', 'Uplift')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('uplift', true)]);
    const r = await heartbeat.runHeartbeatSweep();
    expect(r.recorded).toBe(1);
    const beats = await heartbeat.getHeartbeats();
    expect(beats['old-agent']).toMatchObject({ slug: 'old-agent', up: true });
    expect(beats['uplift-agent']).toBeDefined();
  });

  it('survives a corrupt heartbeat file', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, 'not json at all {{{');
    agentStore.getAllAgents.mockResolvedValue([agent('uplift-agent', 'Uplift')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('uplift', true)]);
    const r = await heartbeat.runHeartbeatSweep();
    expect(r.recorded).toBe(1);
    expect(await heartbeat.getHeartbeats()).toHaveProperty('uplift-agent');
  });

  it('uses the registry agent id (falling back to slug) when updating status', async () => {
    agentStore.getAllAgents.mockResolvedValue([agent('sports-steve', 'Sports Steve', 'id-123')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('sports-steve', false)]);
    await heartbeat.runHeartbeatSweep();
    expect(agentStore.updateAgentStatus).toHaveBeenCalledWith('id-123', 'offline');
  });
});

describe('getHeartbeats', () => {
  it('returns an empty map when nothing has been recorded', async () => {
    expect(await heartbeat.getHeartbeats()).toEqual({});
  });

  it('returns records persisted by the last sweep', async () => {
    agentStore.getAllAgents.mockResolvedValue([agent('hemp-os', 'Hemp-OS')]);
    serviceManager.probeAllServices.mockResolvedValue([svc('hemp-os', false)]);
    await heartbeat.runHeartbeatSweep();
    const beats = await heartbeat.getHeartbeats();
    expect(beats['hemp-os']).toMatchObject({ slug: 'hemp-os', name: 'Hemp-OS', up: false });
  });
});
