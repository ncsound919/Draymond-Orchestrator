import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, applyUpgrades } from '../src/lib/db/connection';
import { LocalClient } from '../src/lib/db';
describe('local query builder', () => {
  let client: LocalClient;

  beforeEach(() => {
    client = new LocalClient(createTestDb());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts and selects rows with JSON/bool conversion', async () => {
    const { error } = await client
      .from('draymond_entities')
      .insert({
        name: 'Test Agent',
        slug: 'test-agent',
        kind: 'agent',
        capabilities: ['code', 'research'],
        tags: ['a'],
        is_active: true,
        is_free: false,
        config: { retries: 3 },
      });
    expect(error).toBeNull();

    const { data, error: selErr } = await client
      .from('draymond_entities')
      .select('*')
      .eq('slug', 'test-agent')
      .single();
    expect(selErr).toBeNull();
    expect(data.name).toBe('Test Agent');
    expect(data.capabilities).toEqual(['code', 'research']);
    expect(data.is_active).toBe(true);
    expect(data.is_free).toBe(false);
    expect(typeof data.id).toBe('string');
    expect(data.created_at).toBeTruthy();
  });

  it('returns count with head:true', async () => {
    await client.from('draymond_agents').insert([{ name: 'A', slug: 'a' }, { name: 'B', slug: 'b' }]);
    const { count, error, data } = await client
      .from('draymond_agents')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    expect(error).toBeNull();
    expect(data).toBeNull();
    expect(count).toBe(2);
  });

  it('supports eq/gte/in/order/limit/range filters', async () => {
    for (let i = 1; i <= 5; i++) {
      await client.from('draymond_agents').insert({ name: `Agent ${i}`, slug: `agent-${i}`, max_retries: i });
    }
    const { data } = await client
      .from('draymond_agents')
      .select('slug, max_retries')
      .gte('max_retries', 2)
      .in('slug', ['agent-2', 'agent-4', 'agent-5'])
      .order('max_retries', { ascending: false })
      .limit(2);
    expect(data?.map((r: { slug: string }) => r.slug)).toEqual(['agent-5', 'agent-4']);

    const { data: ranged } = await client
      .from('draymond_agents')
      .select('slug')
      .order('slug')
      .range(1, 2);
    expect(ranged?.map((r: { slug: string }) => r.slug)).toEqual(['agent-2', 'agent-3']);
  });

  it('upserts on a custom conflict target', async () => {
    await client
      .from('draymond_entities')
      .upsert({ name: 'X', slug: 'x', kind: 'tool' }, { onConflict: 'slug' })
      .select('id, name');
    const { data } = await client
      .from('draymond_entities')
      .upsert({ name: 'Y', slug: 'x', kind: 'tool' }, { onConflict: 'slug' })
      .select('id, name')
      .single();
    expect(data.name).toBe('Y');

    const { count } = await client
      .from('draymond_entities')
      .select('*', { count: 'exact', head: true })
      .eq('slug', 'x');
    expect(count).toBe(1);
  });

  it('upsert preserves created_at on conflict (Postgres parity)', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const { data: inserted } = await client
      .from('draymond_site_monitors')
      .upsert({ name: 'm', url: 'https://a.com' }, { onConflict: 'name' })
      .select('created_at, updated_at')
      .single();
    const created1 = inserted.created_at;
    await new Promise((r) => setTimeout(r, 5));
    const { data: reupserted } = await client
      .from('draymond_site_monitors')
      .upsert({ name: 'm', url: 'https://b.com' }, { onConflict: 'name' })
      .select('url, created_at, updated_at')
      .single();
    expect(reupserted.created_at).toBe(created1);
    expect(reupserted.url).toBe('https://b.com');
    expect(reupserted.updated_at).not.toBe(created1);
  });

  it('insert().select().single() returns the inserted row', async () => {
    const { data, error } = await client
      .from('draymond_messages')
      .insert({ session_id: 's1', role: 'user', content: 'hi' })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data.content).toBe('hi');
  });

  it('updates JSON columns and returns rows with select()', async () => {
    await client.from('draymond_agents').insert({ name: 'A', slug: 'a', config: { k: 1 } });
    const { data } = await client
      .from('draymond_agents')
      .update({ config: { k: 2, n: [1, 2] } })
      .eq('slug', 'a')
      .select('config');
    expect(data).toHaveLength(1);
    expect(data[0].config).toEqual({ k: 2, n: [1, 2] });
  });

  it('in() with an empty array matches nothing', async () => {
    await client.from('draymond_agents').insert({ name: 'A', slug: 'a' });
    const { data } = await client.from('draymond_agents').select('slug').in('slug', []);
    expect(data).toEqual([]);
  });

  it('upserts memory on agent_id,user_id,key', async () => {
    await client.from('draymond_memory').upsert(
      { agent_id: 'a1', user_id: 'u1', key: 'k1', value: { v: 1 } },
      { onConflict: 'agent_id,user_id,key' }
    );
    await client.from('draymond_memory').upsert(
      { agent_id: 'a1', user_id: 'u1', key: 'k1', value: { v: 2 } },
      { onConflict: 'agent_id,user_id,key' }
    );
    const { data } = await client
      .from('draymond_memory')
      .select('value')
      .eq('agent_id', 'a1')
      .eq('user_id', 'u1')
      .eq('key', 'k1')
      .single();
    expect(data.value).toEqual({ v: 2 });
  });

  it('supports contains on JSON array columns', async () => {
    await client.from('draymond_entities').insert([
      { name: 'A', slug: 'a', kind: 'agent', capabilities: ['code', 'research'] },
      { name: 'B', slug: 'b', kind: 'tool', capabilities: ['music'] },
    ]);
    const { data } = await client
      .from('draymond_entities')
      .select('slug')
      .contains('capabilities', ['code']);
    expect(data?.map((r: { slug: string }) => r.slug)).toEqual(['a']);
  });

  it('supports or() with ilike', async () => {
    await client.from('draymond_entities').insert([
      { name: 'Alpha Agent', slug: 'alpha', kind: 'agent' },
      { name: 'Beta Tool', slug: 'beta', kind: 'tool' },
    ]);
    const { data } = await client
      .from('draymond_entities')
      .select('slug')
      .or('name.ilike.%alpha%,slug.ilike.%beta%');
    expect(data?.map((r: { slug: string }) => r.slug)).toEqual(['alpha', 'beta']);
  });

  it('supports single/maybeSingle semantics', async () => {
    const { error } = await client.from('draymond_agents').select('*').eq('slug', 'nope').single();
    expect(error?.code).toBe('PGRST116');

    const maybe = await client.from('draymond_agents').select('*').eq('slug', 'nope').maybeSingle();
    expect(maybe.data).toBeNull();
    expect(maybe.error).toBeNull();
  });

  it('updates with updated_at bump and filters', async () => {
    await client.from('draymond_agents').insert({ name: 'A', slug: 'a', status: 'active' });
    const before = await client.from('draymond_agents').select('updated_at').eq('slug', 'a').single();
    await new Promise((r) => setTimeout(r, 5));
    await client.from('draymond_agents').update({ status: 'degraded' }).eq('slug', 'a');
    const { data } = await client.from('draymond_agents').select('status, updated_at').eq('slug', 'a').single();
    expect(data.status).toBe('degraded');
    expect(data.updated_at).not.toBe(before.data.updated_at);
  });

  it('deletes matching rows', async () => {
    await client.from('draymond_agents').insert([{ name: 'A', slug: 'a' }, { name: 'B', slug: 'b' }]);
    await client.from('draymond_agents').delete().eq('slug', 'a');
    const { count } = await client.from('draymond_agents').select('*', { count: 'exact', head: true });
    expect(count).toBe(1);
  });

  it('insert().select() returns the inserted rows', async () => {
    const { data, error } = await client
      .from('draymond_benchmarks')
      .insert([
        { run_id: 'r1', component_class: 'entity', component_slug: 'x', component_name: 'X' },
      ])
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].run_id).toBe('r1');
  });

  it('runs the chain execution plan RPC', async () => {
    const entity = await client
      .from('draymond_entities')
      .upsert({ name: 'E', slug: 'e', kind: 'tool' }, { onConflict: 'slug' })
      .select('id')
      .single();
    const chain = await client
      .from('draymond_chains')
      .insert({ name: 'C', slug: 'c', status: 'draft' })
      .select('id')
      .single();
    await client.from('draymond_chain_steps').insert({
      chain_id: chain.data.id,
      step_order: 1,
      name: 'Step 1',
      entity_id: entity.data.id,
      action: 'run',
      depends_on_steps: [],
    });

    const { data, error } = await client.rpc('draymond_get_chain_execution_plan', {
      p_chain_id: chain.data.id,
    });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0].entity_name).toBe('E');
    expect(data[0].depends_on_steps).toEqual([]);
  });
});

describe('schema upgrades', () => {
  it('back-fills deep_scores onto a pre-existing draymond_benchmarks table', () => {
    // Simulate an old DB file: create the table without the deep_scores column.
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE draymond_benchmarks (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        component_class TEXT NOT NULL,
        component_slug TEXT NOT NULL,
        component_name TEXT NOT NULL,
        metrics TEXT NOT NULL DEFAULT '{}',
        weakness_score REAL NOT NULL DEFAULT 0,
        trend TEXT NOT NULL DEFAULT '{}',
        evidence TEXT,
        run_at TEXT NOT NULL
      );
    `);
    const before = (db.prepare('PRAGMA table_info(draymond_benchmarks)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(before).not.toContain('deep_scores');

    applyUpgrades(db);

    const after = (db.prepare('PRAGMA table_info(draymond_benchmarks)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(after).toContain('deep_scores');

    // The back-filled column must accept the default so old inserts still work.
    db.prepare(`INSERT INTO draymond_benchmarks (id, run_id, component_class, component_slug, component_name, run_at)
                VALUES ('a', 'r1', 'entity', 'x', 'X', '2026-08-07T00:00:00Z')`).run();
    const row = db.prepare('SELECT deep_scores FROM draymond_benchmarks WHERE id = ?').get('a') as { deep_scores: string };
    expect(row.deep_scores).toBe('{}');
  });

  it('is idempotent — running it twice leaves the column unchanged', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE draymond_benchmarks (id TEXT PRIMARY KEY, deep_scores TEXT NOT NULL DEFAULT '{}')`);
    applyUpgrades(db);
    applyUpgrades(db);
    const cols = (db.prepare('PRAGMA table_info(draymond_benchmarks)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols.filter((c) => c === 'deep_scores')).toHaveLength(1);
  });
});
