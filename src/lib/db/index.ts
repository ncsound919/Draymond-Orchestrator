// ============================================================================
// Local DB client factory
// ============================================================================
// Drop-in replacement for the supabase-js clients used across Draymond.
// `createLocalClient` (async) and `createLocalAdminClient` (sync) both return a
// client exposing `.from(table)` and `.rpc()` backed by the local SQLite file.
// ============================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */

import { getDb, type Db } from './connection';
import { LocalQueryBuilder } from './query-builder';

export class LocalClient {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  from(table: string): LocalQueryBuilder {
    return new LocalQueryBuilder(this.db, table);
  }

  rpc(fn: string, args?: Record<string, any>): LocalQueryBuilder {
    const b = new LocalQueryBuilder(this.db, '');
    b.rpc(fn, args);
    return b;
  }
}

/** Async variant — matches the `await createDraymondClient()` call sites. */
export async function createLocalClient(): Promise<LocalClient> {
  return new LocalClient(getDb());
}

/** Sync variant — matches the `createDraymondAdminClient()` call sites. */
export function createLocalAdminClient(): LocalClient {
  return new LocalClient(getDb());
}
