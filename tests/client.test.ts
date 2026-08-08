import { beforeEach, describe, expect, it } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { createDraymondAdminClient, createDraymondClient } from '../src/lib/draymond/client';

describe('createDraymondClient', () => {
  beforeEach(() => {
    process.env.DRAYMOND_DB_PATH = ':memory:';
  });

  it('returns a working local client', async () => {
    const client = await createDraymondClient();
    const { error } = await client
      .from('draymond_entities')
      .upsert({ name: 'X', slug: 'x', kind: 'agent' }, { onConflict: 'slug' })
      .select('id, slug');
    expect(error).toBeNull();
    const { data } = await client.from('draymond_entities').select('slug').eq('slug', 'x').single();
    expect(data.slug).toBe('x');
  });
});

describe('createDraymondAdminClient', () => {
  it('returns a working local client', async () => {
    const client = createDraymondAdminClient();
    const { error } = await client.from('draymond_site_monitors').insert({
      name: 'monitor-1',
      url: 'https://example.com',
    });
    expect(error).toBeNull();
  });
});
