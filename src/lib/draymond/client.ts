// ============================================================================
// DRAYMOND — Local Database Client
// ============================================================================
// Draymond previously used Supabase (Postgres + RLS). This module now returns
// a supabase-js-compatible query builder backed by a local SQLite file — no
// network, no account, no cost, runs 24/7 inside the Draymond process.
//
// Both `createDraymondClient` (async) and `createDraymondAdminClient` (sync)
// return the same local client: on a single-user private instance there is no
// RLS distinction, so the admin/anon split is a no-op kept for compatibility.
// ============================================================================

import { createLocalAdminClient, createLocalClient } from '@/lib/db';

/**
 * Create the local DB client. Async variant kept for compatibility with
 * existing `await createDraymondClient()` call sites.
 */
export async function createDraymondClient() {
  return createLocalClient();
}

/**
 * Create the local DB client (sync). Bypasses RLS in the same way the old
 * service-role client did — on a local single-user instance everything is
 * trusted server-side code.
 */
export function createDraymondAdminClient() {
  return createLocalAdminClient();
}
