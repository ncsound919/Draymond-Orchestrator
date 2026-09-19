/**
 * Agent Store — persists registered agents, workflows, and systems
 * to .draymond/registry.json on disk. In production, swap the
 * read/write functions for a database adapter without changing callers.
 */
import fs from 'fs/promises';
import path from 'path';
import { existsSync, statSync } from 'node:fs';
import { RegisteredAgent, RegisteredWorkflow, RegisteredSystem, RegisteredSkill } from './types';

const REGISTRY_DIR = process.env.DRAYMOND_REGISTRY_DIR
  ?? path.join(process.cwd(), '.draymond');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'registry.json');

const AVATAR_DIR = path.join(process.cwd(), 'public', 'avatars');

/**
 * Memoised avatar-existence check. The previous implementation ran a sync
 * existsSync + statSync per agent on EVERY roster request (48+ stat calls
 * per hit), which dominated the latency of /api/v1/agents and
 * /api/registry/agents. Results are cached per avatar path and invalidated
 * after AVATAR_CACHE_TTL_MS so a re-upload becomes visible within one TTL.
 */
const AVATAR_CACHE_TTL_MS = Number(process.env.DRAYMOND_AVATAR_CACHE_TTL_MS ?? 30000);
const avatarCache = new Map<string, { real: boolean; at: number }>();

/**
 * True when the agent has a real portrait file (not the 533-byte default
 * placeholder). Used to sort the roster so piced agents float to the top.
 */
export function hasRealAvatar(agent: Pick<RegisteredAgent, 'avatarUrl'>): boolean {
  if (!agent.avatarUrl) return false;
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- path.basename() strips directory components before the join.
  const file = path.join(AVATAR_DIR, path.basename(agent.avatarUrl));
  const cached = avatarCache.get(file);
  if (cached && Date.now() - cached.at < AVATAR_CACHE_TTL_MS) {
    return cached.real;
  }
  let real = false;
  try {
    real = existsSync(file) && statSync(file).size > 1024;
  } catch {
    real = false;
  }
  avatarCache.set(file, { real, at: Date.now() });
  return real;
}

interface RegistryStore {
  agents: RegisteredAgent[];
  workflows: RegisteredWorkflow[];
  systems: RegisteredSystem[];
  skills?: RegisteredSkill[];
  updatedAt: string;
}

/**
 * Write-mutex: serialises all read-modify-write operations so concurrent
 * calls (e.g. two heartbeat updates arriving at the same time) never
 * clobber each other.
 */
let _lock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const result = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  _lock = _lock
    .then(() => fn().then(resolve, reject))
    .catch(() => undefined); // never break the chain
  return result;
}

/**
 * TTL read-cache for the on-disk registry. Reads and JSON.parse of the full
 * registry (179KB+) used to run on every /api/v1/agents and /api/registry/*
 * request — the hottest fleet endpoints. The cache is invalidated on any
 * write, so a fresh read happens at most once per READ_TTL_MS during steady
 * state. Set READ_TTL_MS = 0 to disable caching entirely.
 */
const READ_TTL_MS = Number(process.env.DRAYMOND_REGISTRY_CACHE_TTL_MS ?? 5000);
let _readCache: { store: RegistryStore; at: number } | null = null;

async function ensureDir(): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
}

async function readStore(): Promise<RegistryStore> {
  await ensureDir();
  const now = Date.now();
  if (_readCache && now - _readCache.at < READ_TTL_MS) {
    return _readCache.store;
  }
  const store = await readStoreFromDisk();
  if (READ_TTL_MS > 0) _readCache = { store, at: now };
  return store;
}

async function invalidateReadCache(): Promise<void> {
  _readCache = null;
  _agentsListCache = null;
}

async function readStoreFromDisk(): Promise<RegistryStore> {
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
      return { agents: [], workflows: [], systems: [], skills: [], updatedAt: new Date().toISOString() };
    }

    const parsedStore = parsed as RegistryStore;
    if (!Array.isArray(parsedStore.skills)) {
      parsedStore.skills = [];
    }
    return parsedStore;
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
  await invalidateReadCache();
}

// -- Agents -------------------------------------------------------------------

let _agentsListCache: { agents: RegisteredAgent[]; at: number } | null = null;
const AGENTS_LIST_TTL_MS = Number(process.env.DRAYMOND_AGENTS_LIST_TTL_MS ?? 10000);

export async function getAllAgents(): Promise<RegisteredAgent[]> {
  const now = Date.now();
  if (_agentsListCache && now - _agentsListCache.at < AGENTS_LIST_TTL_MS) {
    return _agentsListCache.agents;
  }
  const agents = (await readStore()).agents;
  // Piced agents first, stable within each group.
  const sorted = [...agents].sort(
    (a, b) => Number(hasRealAvatar(b)) - Number(hasRealAvatar(a))
  );
  if (AGENTS_LIST_TTL_MS > 0) _agentsListCache = { agents: sorted, at: now };
  return sorted;
}

export async function getAgentBySlug(slug: string): Promise<RegisteredAgent | null> {
  const agents = await getAllAgents();
  return agents.find((a) => a.slug === slug) ?? null;
}

export async function upsertAgent(agent: RegisteredAgent): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      store.agents[idx] = { ...agent, updatedAt: new Date().toISOString() };
    } else {
      store.agents.push(agent);
    }
    await writeStore(store);
  });
}

/**
 * Update just the avatar for an agent (photo upload flow).
 * Leaves every other field untouched.
 */
export async function updateAgentAvatar(slug: string, avatarUrl: string): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.agents.findIndex((a) => a.slug === slug);
    if (idx >= 0) {
      store.agents[idx] = { ...store.agents[idx], avatarUrl, updatedAt: new Date().toISOString() };
      await writeStore(store);
    }
  });
}

/**
 * Update just the stats (roster benchmark bars) for an agent.
 * Leaves every other field untouched.
 */
export async function updateAgentStats(slug: string, stats: RegisteredAgent['stats']): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.agents.findIndex((a) => a.slug === slug);
    if (idx >= 0) {
      store.agents[idx] = { ...store.agents[idx], stats, updatedAt: new Date().toISOString() };
      await writeStore(store);
    }
  });
}

export async function deleteAgent(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.agents.length;
    store.agents = store.agents.filter((a) => a.id !== id);
    await writeStore(store);
    return store.agents.length < before;
  });
}

export async function updateAgentStatus(
  id: string,
  status: RegisteredAgent['status'],
): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const agent = store.agents.find((a) => a.id === id);
    if (agent) {
      agent.status = status;
      agent.updatedAt = new Date().toISOString();
      await writeStore(store);
    }
  });
}

// -- Workflows -----------------------------------------------------------------

export async function getAllWorkflows(): Promise<RegisteredWorkflow[]> {
  return (await readStore()).workflows;
}

export async function upsertWorkflow(wf: RegisteredWorkflow): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.workflows.findIndex((w) => w.id === wf.id);
    if (idx >= 0) store.workflows[idx] = wf;
    else store.workflows.push(wf);
    await writeStore(store);
  });
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.workflows.length;
    store.workflows = store.workflows.filter((w) => w.id !== id);
    await writeStore(store);
    return store.workflows.length < before;
  });
}

// -- Systems -------------------------------------------------------------------

export async function getAllSystems(): Promise<RegisteredSystem[]> {
  return (await readStore()).systems;
}

export async function upsertSystem(sys: RegisteredSystem): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const idx = store.systems.findIndex((s) => s.id === sys.id);
    if (idx >= 0) store.systems[idx] = sys;
    else store.systems.push(sys);
    await writeStore(store);
  });
}

export async function deleteSystem(id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const before = store.systems.length;
    store.systems = store.systems.filter((s) => s.id !== id);
    await writeStore(store);
    return store.systems.length < before;
  });
}

export async function getFullRegistry(): Promise<RegistryStore> {
  return readStore();
}

export async function getAllSkills(): Promise<RegisteredSkill[]> {
  return (await readStore()).skills ?? [];
}

export async function upsertSkill(skill: RegisteredSkill): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    store.skills = store.skills ?? [];
    const idx = store.skills.findIndex((s) => s.id === skill.id);
    if (idx >= 0) store.skills[idx] = skill;
    else store.skills.push(skill);
    await writeStore(store);
  });
}
