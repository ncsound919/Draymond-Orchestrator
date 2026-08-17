// ============================================================================
// DRAYMOND — Bridge Store Singleton
// ============================================================================
// Module-level singleton for the in-memory bridge store, shared across all
// /api/bridge/v1 route handlers so environments/work survive across requests.
// Uses globalThis to avoid double-instantiation under Next.js dev hot-reload.
// ============================================================================

import { BridgeStore } from './bridge-server';

const GLOBAL_KEY = '__draymond_bridge_store__';

type BridgeGlobal = typeof globalThis & { [GLOBAL_KEY]?: BridgeStore };

export function getBridgeStore(): BridgeStore {
  const g = globalThis as BridgeGlobal;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new BridgeStore();
  }
  return g[GLOBAL_KEY];
}

/** Reset the singleton (tests). */
export function resetBridgeStore(): void {
  const g = globalThis as BridgeGlobal;
  if (g[GLOBAL_KEY]) {
    g[GLOBAL_KEY].reset();
  }
}
