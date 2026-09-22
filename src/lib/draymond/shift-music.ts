// ============================================================================
// MUSIC / RECOURSE SHIFT — contract module (Agent C)
// ============================================================================
// This module is the CONTRACT the main integrator consumes to build the
// `music-shift` chain (chains.ts / business-chains.ts). It is pure data +
// types: no fetch, no side effects, no delegation edits.
//
// Truth of the pipeline (locked plan §5, verified against the canonical
// recourse repo at C:\Users\User\Downloads\recourse):
//   - recourse owns the composer learner + rating store. It has NOT been
//     modified here; the shift only drives its HTTP surface.
//   - GET /api/recourse/compose/* and GET /api/recourse/rating/* are read /
//     CORS-open. POST routes are mutation-guarded (RECOURSE_API_SECRET).
//   - HONEST RULE: human ratings are the ONLY taste signal. The composer
//     learner adjusts per-style quality from 1–5 ratings; the rating store
//     records blind A/B choices a human heard. Neither may be fabricated by
//     the shift. `MUSIC_SHIFT_AUTO_RATE_DEFAULT` defaults OFF — when ON the
//     only thing an auto pass may feed is OBJECTIVE benchmark scores, and
//     those must be labeled as such, never claimed as human taste.
// ============================================================================

import type { DelegationSpec } from './delegation';

/** Real composer styles served by recourse (verified from src/lib/composer/types.ts). */
export const MUSIC_SHIFT_STYLES = ['steely-dan', 'jasper-ballad', 'dangelo-glasper', 'airplane'] as const;

export type MusicShiftStyle = (typeof MUSIC_SHIFT_STYLES)[number];

/** Source tag every rating-store write in this shift uses (ChordStudio contract). */
export const MUSIC_SHIFT_RATING_SOURCE = 'chordstudio';

/**
 * autoRate guard. Default OFF. The shift must NOT write taste signals (compose
 * learner 1–5 ratings, blind A/B winners) unless an operator explicitly turns
 * this on — and even then those writes are objective/synthetic, never human.
 */
export const MUSIC_SHIFT_AUTO_RATE_DEFAULT = false;

/**
 * Delegation slugs in delegation.ts `DelegationSpec` shape. The integrator adds
 * these to DELEGATION_PLAN; budgets match the locked plan §5b/§7 (96k + 16k
 * tokens/day ≈ $0.16/day @ $1.50/1M).
 */
export const MUSIC_SHIFT_SLUGS: DelegationSpec[] = [
  {
    slug: 'recourse_compose',
    label: 'Recourse composer learner loop',
    phase: 'night',
    timeBudgetMs: 900_000,
    tokenBudgetPerRun: 64_000,
    tokenBudgetPerDay: 96_000,
    tier: 'flash',
    priority: 2,
    duty: 'night',
  },
  {
    slug: 'recourse_rating',
    label: 'Recourse rating loop (ChordStudio Elo)',
    phase: 'night',
    timeBudgetMs: 120_000,
    tokenBudgetPerRun: 8_000,
    tokenBudgetPerDay: 16_000,
    tier: 'free',
    priority: 2,
    duty: 'night',
  },
];

/**
 * Every real recourse route path this shift may hit (verified against
 * src/routes/compose.ts + src/routes/rating.ts, mounted at /api/recourse).
 * The test asserts MUSIC_SHIFT_SEQUENCE references nothing outside this set.
 */
export const MUSIC_SHIFT_VERIFIED_ENDPOINTS: readonly string[] = [
  // compose.ts
  '/api/recourse/compose',
  '/api/recourse/compose/styles',
  '/api/recourse/compose/soundlab',
  '/api/recourse/compose/soundlab.json',
  '/api/recourse/compose/song.json',
  '/api/recourse/compose/jev',
  '/api/recourse/compose/jev/rerank',
  '/api/recourse/compose/wav',
  '/api/recourse/compose/stems',
  '/api/recourse/compose/track.json',
  '/api/recourse/compose/midi',
  '/api/recourse/compose/rate',
  '/api/recourse/compose/learned',
  '/api/recourse/compose/suggest',
  '/api/recourse/compose/benchmark',
  // rating.ts
  '/api/recourse/rating/standings',
  '/api/recourse/rating/variations',
  '/api/recourse/rating/suggest',
  '/api/recourse/rating/pair/next',
  '/api/recourse/rating/ledger',
  '/api/recourse/rating/variation',
  '/api/recourse/rating/pair',
];

/** One ordered step in the music-shift sequence. */
export interface MusicShiftStep {
  /** Ordinal position in the shift (1-based). */
  order: number;
  /** Task-group stage from the locked plan §5a (1–6). */
  stage: 1 | 2 | 3 | 4 | 5 | 6;
  key: string;
  label: string;
  method: 'GET' | 'POST';
  /** Full path on the recourse service (includes /api/recourse). */
  path: string;
  /** Which recourse router owns the step. */
  router: 'compose' | 'rating';
  /** Query-string params (GET) the chain fills per style/seed. */
  queryParams?: Record<string, unknown>;
  /** JSON body template (POST). */
  body?: Record<string, unknown>;
  /**
   * True when the step writes a TASTE signal (learner rating / A/B winner) and
   * MUST be skipped unless autoRate is explicitly enabled. Registers variations
   * and read-only steps are safe with the guard off.
   */
  autoRateGuard: boolean;
  /** Honest note for dashboards / operator logs. */
  note: string;
}

/**
 * Ordered steps the `music-shift` chain runs. Matches plan §5a:
 *   1. suggest (per style) → 2. learner rate (guarded) → 3. variation + blind
 *   A/B (winner guarded) → 4. standings (Elo write-back) → 5. artifact export
 *   (wav/midi) → 6. SoundLab piece for the web consumer.
 */
export const MUSIC_SHIFT_SEQUENCE: readonly MusicShiftStep[] = [
  {
    order: 1,
    stage: 1,
    key: 'compose_suggest',
    label: 'Compose suggestions per style',
    method: 'GET',
    path: '/api/recourse/compose/suggest',
    router: 'compose',
    queryParams: { style: '<style>', count: 4 },
    autoRateGuard: false,
    note: 'Candidate briefs near what was rated. Read-only.',
  },
  {
    order: 2,
    stage: 2,
    key: 'compose_rate',
    label: 'Composer learner rating intake',
    method: 'POST',
    path: '/api/recourse/compose/rate',
    router: 'compose',
    body: { style: '<style>', seed: 1, bars: 8, rating: 3 },
    autoRateGuard: true,
    note: 'Learner 1–5 per style/seed. autoRate only — objective benchmark scores, never human taste, never claimed as autonomy.',
  },
  {
    order: 3,
    stage: 3,
    key: 'rating_variation',
    label: 'Register rating variation',
    method: 'POST',
    path: '/api/recourse/rating/variation',
    router: 'rating',
    body: { source: MUSIC_SHIFT_RATING_SOURCE, params: { style: '<style>', seed: 1, bars: 8 } },
    autoRateGuard: false,
    note: 'Registers candidate variations for the parent pool. No taste claim.',
  },
  {
    order: 4,
    stage: 3,
    key: 'rating_pair',
    label: 'Record blind A/B choice',
    method: 'POST',
    path: '/api/recourse/rating/pair',
    router: 'rating',
    body: { source: MUSIC_SHIFT_RATING_SOURCE, a: '<hashA>', b: '<hashB>', winner: '<A|B>' },
    autoRateGuard: true,
    note: 'Winner MUST come from a real human ChordStudio session. Never fabricate a choice.',
  },
  {
    order: 5,
    stage: 4,
    key: 'rating_standings',
    label: 'Elo standings write-back',
    method: 'GET',
    path: '/api/recourse/rating/standings',
    router: 'rating',
    queryParams: { source: MUSIC_SHIFT_RATING_SOURCE },
    autoRateGuard: false,
    note: 'Recompute Elo from the ledger; top parents seed the next variation batch.',
  },
  {
    order: 6,
    stage: 5,
    key: 'compose_export',
    label: 'Artifact export (wav/midi)',
    method: 'GET',
    path: '/api/recourse/compose/wav',
    router: 'compose',
    queryParams: { style: '<style>', seed: 1, bars: 8 },
    autoRateGuard: false,
    note: 'Offline PCM render. Swap path to /compose/midi for a DAW importable .mid.',
  },
  {
    order: 7,
    stage: 6,
    key: 'compose_soundlab',
    label: 'SoundLab piece for web consumer',
    method: 'GET',
    path: '/api/recourse/compose/soundlab.json',
    router: 'compose',
    queryParams: { style: '<style>', seed: 1, bars: 8 },
    autoRateGuard: false,
    note: 'Deterministic per (style, seed); consumed by the SoundLab __recourse bridge.',
  },
];