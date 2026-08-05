import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockAdmin, mockLogEvent } = vi.hoisted(() => {
  const makeChain = (getResult: () => unknown) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      range: vi.fn(() => chain),
      contains: vi.fn(() => chain),
      or: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      upsert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      in: vi.fn(() => chain),
      single: vi.fn(() => Promise.resolve(getResult())),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(getResult()).then(onF, onR),
    };
    return chain;
  };
  const build = (tables: Map<string, unknown>) => ({
    from: vi.fn((t: string) => {
      const resolve = () => tables.get(t) ?? { data: null, error: null };
      return makeChain(resolve);
    }),
    _tables: tables,
  });
  const client = build(new Map());
  const admin = build(new Map());
  return { mockClient: client, mockAdmin: admin, mockLogEvent: vi.fn(async () => {}) };
});

vi.mock('../src/lib/draymond/client', () => ({
  createDraymondClient: vi.fn(() => mockClient),
  createDraymondAdminClient: vi.fn(() => mockAdmin),
}));
vi.mock('../src/lib/draymond/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/draymond/index')>();
  return { ...actual, logEvent: mockLogEvent };
});

import {
  registerEntity,
  registerEntities,
  getEntity,
  updateEntity,
  deactivateEntity,
  searchEntities,
  getEntityCounts,
  recordInvocation,
  findByCapability,
  getAllCapabilities,
  createRelation,
  getEntityRelations,
  getRegistryStats,
} from '../src/lib/draymond/registry';

function setClient(table: string, data: unknown, error: unknown = null) {
  mockClient._tables.set(table, { data, error });
}
function setAdmin(table: string, data: unknown, error: unknown = null) {
  mockAdmin._tables.set(table, { data, error });
}

afterEach(() => {
  mockClient._tables.clear();
  mockAdmin._tables.clear();
});

describe('registerEntity', () => {
  it('throws on an invalid slug', async () => {
    await expect(registerEntity({ slug: 'Bad Slug!', name: 'X', kind: 'agent' })).rejects.toThrow(/Invalid slug/);
  });

  it('throws when name is missing', async () => {
    await expect(registerEntity({ slug: 'ok', name: '', kind: 'agent' })).rejects.toThrow(/name is required/);
  });

  it('upserts an entity and returns it', async () => {
    const entity = { id: 'e1', slug: 'riggs', name: 'Riggs', kind: 'agent' };
    setClient('draymond_entities', entity);
    const result = await registerEntity({ slug: 'riggs', name: 'Riggs', kind: 'agent' });
    expect(result.slug).toBe('riggs');
    expect(result.kind).toBe('agent');
  });

  it('throws when the database insert fails', async () => {
    setClient('draymond_entities', null, { message: 'db down' });
    await expect(registerEntity({ slug: 'riggs', name: 'Riggs', kind: 'agent' })).rejects.toThrow(/db down/);
  });
});

describe('registerEntities', () => {
  it('registers a batch and reports per-item errors', async () => {
    setClient('draymond_entities', { id: 'ok' });
    // Force one to fail by making a duplicate-with-different-slug that fails validation
    const result = await registerEntities([
      { slug: 'moss', name: 'Moss', kind: 'agent' },
      { slug: 'Bad Slug!', name: 'Bad', kind: 'agent' },
    ]);
    expect(result.registered).toBe(1);
    expect(result.errors.length).toBe(1);
  });
});

describe('getEntity', () => {
  it('returns the entity when found (admin client)', async () => {
    setAdmin('draymond_entities', { id: 'e1', slug: 'echo', name: 'Echo' });
    const entity = await getEntity('echo');
    expect(entity?.name).toBe('Echo');
  });

  it('returns null when not found', async () => {
    setAdmin('draymond_entities', null); // PGRST116-equivalent
    const entity = await getEntity('nope');
    expect(entity).toBeNull();
  });
});

describe('updateEntity / deactivateEntity', () => {
  it('updates and returns the entity', async () => {
    setClient('draymond_entities', { id: 'e1', name: 'Updated' });
    const result = await updateEntity('e1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('throws on update error', async () => {
    setClient('draymond_entities', null, { message: 'update failed' });
    await expect(updateEntity('e1', {})).rejects.toThrow(/update failed/);
  });

  it('deactivates an existing entity', async () => {
    setClient('draymond_entities', { id: 'e1' });
    await expect(deactivateEntity('e1')).resolves.toBeUndefined();
  });

  it('throws when deactivating a missing entity', async () => {
    setClient('draymond_entities', null);
    await expect(deactivateEntity('missing')).rejects.toThrow(/not found/);
  });
});

describe('searchEntities / counts / invocation', () => {
  it('returns entities from a filtered search', async () => {
    setClient('draymond_entities', [{ id: 'e1', slug: 'riggs', kind: 'agent' }]);
    const results = await searchEntities({ kind: 'agent', search: 'riggs' });
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe('riggs');
  });

  it('getEntityCounts groups by kind', async () => {
    setClient('draymond_entities', [{ kind: 'agent' }, { kind: 'agent' }, { kind: 'tool' }]);
    const counts = await getEntityCounts();
    expect(counts.agent).toBe(2);
    expect(counts.tool).toBe(1);
  });

  it('recordInvocation updates last_invoked_at and logs an event when agentId is set', async () => {
    mockLogEvent.mockClear();
    setClient('draymond_entities', null);
    await recordInvocation('e1', 'agent-1');
    expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'entity_invoked' }));
  });

  it('findByCapability returns entities that match the capability', async () => {
    setClient('draymond_entities', [{ id: 'e1', slug: 'riggs', capabilities: ['debugging'] }]);
    const result = await findByCapability('debugging');
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('riggs');
  });

  it('getAllCapabilities dedupes and sorts capabilities', async () => {
    setClient('draymond_entities', [
      { capabilities: ['zebra', 'alpha'] },
      { capabilities: ['alpha', 'middle'] },
    ]);
    const caps = await getAllCapabilities();
    expect(caps).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('createRelation upserts a relation', async () => {
    setClient('draymond_entity_relations', { id: 'rel-1', relation_type: 'depends_on' });
    const rel = await createRelation({ source_entity_id: 'a', target_entity_id: 'b', relation_type: 'depends_on' });
    expect(rel.id).toBe('rel-1');
  });

  it('getEntityRelations returns outgoing and incoming', async () => {
    setClient('draymond_entity_relations', [{ id: 'rel-1' }]);
    const rels = await getEntityRelations('e1');
    expect(rels.outgoing).toHaveLength(1);
    expect(rels.incoming).toHaveLength(1);
  });

  it('getRegistryStats aggregates kind, integration, and free counts', async () => {
    setClient('draymond_entities', [
      { kind: 'agent', is_integrated: true, is_free: true, capabilities: ['a'] },
      { kind: 'tool', is_integrated: false, is_free: false, capabilities: ['b'] },
      { kind: 'agent', is_integrated: false, is_free: true, capabilities: ['a'] },
    ]);
    const stats = await getRegistryStats();
    expect(stats.total).toBe(3);
    expect(stats.by_kind.agent).toBe(2);
    expect(stats.by_kind.tool).toBe(1);
    expect(stats.integrated).toBe(1);
    expect(stats.free_count).toBe(2);
    expect(stats.paid_count).toBe(1);
    expect(stats.capabilities_count).toBe(2);
  });
});
