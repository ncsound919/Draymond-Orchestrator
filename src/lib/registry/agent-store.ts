/**
 * Agent Store — persists registered agents, workflows, and systems
 * to .draymond/registry.json on disk. In production, swap the
 * read/write functions for a database adapter without changing callers.
 */
import fs from 'fs/promises';
import path from 'path';
import { RegisteredAgent, RegisteredWorkflow, RegisteredSystem } from './types';

const REGISTRY_DIR = process.env.DRAYMOND_REGISTRY_DIR
  ?? path.join(process.cwd(), '.draymond');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'registry.json');

interface RegistryStore {
  agents: RegisteredAgent[];
  workflows: RegisteredWorkflow[];
  systems: RegisteredSystem[];
  updatedAt: string;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
}

async function readStore(): Promise<RegistryStore> {
  await ensureDir();
  try {
    const raw = await fs.readFile(REGISTRY_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    // Runtime shape validation — must be an object with expected arrays
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).agents) ||
      !Array.isArray((parsed as Record<string, unknown>).workflows) ||
      !Array.isArray((parsed as Record<string, unknown>).systems)
    ) {
      console.error('[agent-store] registry.json has invalid shape, returning empty store');
      return { agents: [], workflows: [], systems: [], updatedAt: new Date().toISOString() };
    }

    return parsed as RegistryStore;
  } catch (err) {
    // Log non-ENOENT errors (corrupt file, bad JSON, etc.)
    if (err instanceof SyntaxError) {
      console.error('[agent-store] registry.json contains invalid JSON:', err.message);
    } else if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      console.error('[agent-store] Failed to read registry.json:', err.message);
    }
    return { agents: [], workflows: [], systems: [], updatedAt: new Date().toISOString() };
  }
}

async function writeStore(store: RegistryStore): Promise<void> {
  await ensureDir();
  store.updatedAt = new Date().toISOString();
  await fs.writeFile(REGISTRY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

// ── Agents ───────────────────────────────────────────────────────────────────

export async function getAllAgents(): Promise<RegisteredAgent[]> {
  return (await readStore()).agents;
}

export async function getAgentBySlug(slug: string): Promise<RegisteredAgent | null> {
  const agents = await getAllAgents();
  return agents.find((a) => a.slug === slug) ?? null;
}

export async function upsertAgent(agent: RegisteredAgent): Promise<void> {
  const store = await readStore();
  const idx = store.agents.findIndex((a) => a.id === agent.id);
  if (idx >= 0) {
    store.agents[idx] = { ...agent, updatedAt: new Date().toISOString() };
  } else {
    store.agents.push(agent);
  }
  await writeStore(store);
}

export async function deleteAgent(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.agents.length;
  store.agents = store.agents.filter((a) => a.id !== id);
  await writeStore(store);
  return store.agents.length < before;
}

export async function updateAgentStatus(
  id: string,
  status: RegisteredAgent['status'],
): Promise<void> {
  const store = await readStore();
  const agent = store.agents.find((a) => a.id === id);
  if (agent) {
    agent.status = status;
    agent.updatedAt = new Date().toISOString();
    await writeStore(store);
  }
}

// ── Workflows ─────────────────────────────────────────────────────────────────

export async function getAllWorkflows(): Promise<RegisteredWorkflow[]> {
  return (await readStore()).workflows;
}

export async function upsertWorkflow(wf: RegisteredWorkflow): Promise<void> {
  const store = await readStore();
  const idx = store.workflows.findIndex((w) => w.id === wf.id);
  if (idx >= 0) store.workflows[idx] = wf;
  else store.workflows.push(wf);
  await writeStore(store);
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.workflows.length;
  store.workflows = store.workflows.filter((w) => w.id !== id);
  await writeStore(store);
  return store.workflows.length < before;
}

// ── Systems ───────────────────────────────────────────────────────────────────

export async function getAllSystems(): Promise<RegisteredSystem[]> {
  return (await readStore()).systems;
}

export async function upsertSystem(sys: RegisteredSystem): Promise<void> {
  const store = await readStore();
  const idx = store.systems.findIndex((s) => s.id === sys.id);
  if (idx >= 0) store.systems[idx] = sys;
  else store.systems.push(sys);
  await writeStore(store);
}

export async function deleteSystem(id: string): Promise<boolean> {
  const store = await readStore();
  const before = store.systems.length;
  store.systems = store.systems.filter((s) => s.id !== id);
  await writeStore(store);
  return store.systems.length < before;
}

export async function getFullRegistry(): Promise<RegistryStore> {
  return readStore();
}
