import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

// agent-store reads DRAYMOND_REGISTRY_DIR at module import time, so we must
// point it at a throwaway temp dir BEFORE the import below. Avoid os/path in
// the hoisted callback (they aren't initialized yet) — use env temp + pid.
const { registryDir } = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const dir = `${base}/draymond-registry-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DRAYMOND_REGISTRY_DIR = dir;
  return { registryDir: dir };
});

import {
  getAllAgents,
  getAgentBySlug,
  upsertAgent,
  deleteAgent,
  updateAgentStatus,
  upsertWorkflow,
  getAllWorkflows,
  deleteWorkflow,
  upsertSystem,
  getAllSystems,
  deleteSystem,
  getFullRegistry,
} from '../src/lib/registry/agent-store';
import type { RegisteredAgent, RegisteredWorkflow, RegisteredSystem } from '../src/lib/registry/types';

afterAll(() => {
  delete process.env.DRAYMOND_REGISTRY_DIR;
  fs.rmSync(registryDir, { recursive: true, force: true });
});

beforeAll(() => {
  fs.mkdirSync(registryDir, { recursive: true });
});

function makeAgent(slug: string, extra: Partial<RegisteredAgent> = {}): RegisteredAgent {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    version: '1.0.0',
    tier: 'custom',
    role: 'Assistant',
    bio: '',
    personality: 'analytical',
    specialties: [],
    capabilities: [],
    stats: [],
    tags: [],
    theme: { accentColor: '#6366f1', cardStyle: 'glass', portraitFrame: 'hexagon', badgeColor: '#6366f1' },
    runtime: { type: 'http', healthPath: '/health', timeoutMs: 30000 },
    permissions: {
      canReadFiles: false,
      canWriteFiles: false,
      canRunCommands: false,
      canAccessInternet: true,
      canAccessDatabase: false,
      canSendEmail: false,
    },
    workflows: [],
    memoryEnabled: true,
    persistentMemory: false,
    status: 'unknown',
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceType: 'registry',
    ...extra,
  };
}

describe('agent-store', () => {
  it('returns empty lists on a fresh registry', async () => {
    expect(await getAllAgents()).toEqual([]);
    expect(await getAllWorkflows()).toEqual([]);
    expect(await getAllSystems()).toEqual([]);
  });

  it('upserts and retrieves an agent by slug', async () => {
    await upsertAgent(makeAgent('rex', { role: 'Sales Agent' }));

    const agent = await getAgentBySlug('rex');
    expect(agent).not.toBeNull();
    expect(agent?.role).toBe('Sales Agent');

    const all = await getAllAgents();
    expect(all).toHaveLength(1);
    expect(all[0].slug).toBe('rex');
  });

  it('updates an existing agent in place (same id)', async () => {
    await upsertAgent(makeAgent('rex', { role: 'Sales Agent' }));
    await upsertAgent(makeAgent('rex', { role: 'Updated Role' }));

    const all = await getAllAgents();
    expect(all).toHaveLength(1);
    expect(all[0].role).toBe('Updated Role');
  });

  it('updateAgentStatus changes the stored status', async () => {
    await upsertAgent(makeAgent('echo', {}));
    await updateAgentStatus('id-echo', 'online');
    const agent = await getAgentBySlug('echo');
    expect(agent?.status).toBe('online');
  });

  it('deleteAgent removes by id and reports success', async () => {
    await upsertAgent(makeAgent('hype', {}));
    const deleted = await deleteAgent('id-hype');
    expect(deleted).toBe(true);
    expect(await getAgentBySlug('hype')).toBeNull();
    expect(await deleteAgent('id-hype')).toBe(false);
  });

  it('persists workflows', async () => {
    const wf: RegisteredWorkflow = {
      id: 'wf-1',
      name: 'Daily',
      description: 'x',
      version: '1.0.0',
      steps: [],
      assignedAgents: ['rex'],
      trigger: 'manual',
      tags: [],
      installedAt: new Date().toISOString(),
      sourceType: 'folder',
    };
    await upsertWorkflow(wf);
    const all = await getAllWorkflows();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Daily');

    expect(await deleteWorkflow('wf-1')).toBe(true);
    expect(await getAllWorkflows()).toEqual([]);
  });

  it('persists systems', async () => {
    const sys: RegisteredSystem = {
      id: 'sys-1',
      name: 'Site',
      config: { endpoint: 'https://x' },
    } as unknown as RegisteredSystem;
    await upsertSystem(sys);
    const all = await getAllSystems();
    expect(all).toHaveLength(1);
    expect(await deleteSystem('sys-1')).toBe(true);
  });

  it('getFullRegistry returns the whole store', async () => {
    await upsertAgent(makeAgent('moss', {}));
    const reg = await getFullRegistry();
    expect(reg.agents.length).toBeGreaterThan(0);
    expect(Array.isArray(reg.workflows)).toBe(true);
    expect(Array.isArray(reg.systems)).toBe(true);
    expect(typeof reg.updatedAt).toBe('string');
  });
});
