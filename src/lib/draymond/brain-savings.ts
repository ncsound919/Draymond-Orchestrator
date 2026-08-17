// ============================================================================
// BRAIN ROUTE SAVINGS — token/cost ledger for deterministic routing
// ============================================================================
// When the deterministic brain pre-route skips a paid LLM call, the tokens it
// would have burned are "saved". This module keeps an in-memory accumulator so
// the /metrics endpoint can expose it as Prometheus gauges and so dashboards
// can show the fleet's deterministic routing savings over time.
//
// In-memory only (no DB write) so it never blocks routing. Persisted scrape
// visibility comes from metrics.ts, which reads getBrainSavings() on refresh.
// ============================================================================

import { tokensToCents } from './cost';

let _savedTokens = 0;
let _savedCents = 0;
let _brainRouted = 0;

/** Record that a deterministic brain pre-route skipped an LLM call. */
export function recordBrainRouteSavings(estimatedTokens: number): void {
  const tokens = Number.isFinite(estimatedTokens) && estimatedTokens > 0 ? estimatedTokens : 0;
  _savedTokens += tokens;
  _savedCents += tokensToCents(tokens);
  _brainRouted += 1;
}

/** Total tokens saved by deterministic brain routing (cumulative, in-memory). */
export function brainTokensSaved(): number {
  return _savedTokens;
}

/** Total cost saved, in cents, at the fleet's per-token rate. */
export function brainSavingsCents(): number {
  return _savedCents;
}

/** Number of tasks routed via the deterministic brain pre-route. */
export function brainRoutedCount(): number {
  return _brainRouted;
}

/** Snapshot for metrics.ts — all three values at once. */
export function getBrainSavings(): { tokens: number; cents: number; routed: number } {
  return { tokens: _savedTokens, cents: _savedCents, routed: _brainRouted };
}
