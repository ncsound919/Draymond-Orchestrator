// ============================================================================
// RECOURSE MUSIC CLIENT — fail-soft compose/rating bridge (Agent C)
// ============================================================================
// Thin, typed wrapper over the canonical recourse composer + rating store
// (canonical repo: C:\Users\User\Downloads\recourse, port 3050). Read-only
// surface only for taste writes: the shift MUST NOT fabricate ratings or A/B
// winners (see shift-music.ts autoRate guard).
//
// Relationship to src/lib/mathx/recourse.ts: that client covers the
// /api/recourse/* OS surface (status/math/lego/verify/templates/memory) and
// lives in the mathx module. It has NO composer/rating coverage, so this
// client is a separate, non-colliding surface in the draymond module.
//
// Honesty contract: every call returns `{ ok:false, reason:'unavailable' }`
// (or the real HTTP status) when the service is unreachable or non-2xx.
// Nothing is fabricated; an unreachable service is reported, never simulated.
// ============================================================================

const RECOURSE_URL = (process.env.RECOURSE_URL || 'http://127.0.0.1:3050').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.RECOURSE_TIMEOUT_MS || 8000);
// Compose/rating POST routes are mutation-guarded (RECOURSE_API_SECRET).
const RECOURSE_API_SECRET = process.env.RECOURSE_API_SECRET || '';

export interface MusicClientOk<T> {
  ok: true;
  data: T;
}

export interface MusicClientErr {
  ok: false;
  reason: string;
  statusCode?: number;
}

export type MusicClientResult<T> = MusicClientOk<T> | MusicClientErr;

async function request<T>(method: 'GET' | 'POST', path: string, query?: Record<string, unknown>, body?: unknown): Promise<MusicClientResult<T>> {
  const url = new URL(`${RECOURSE_URL}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '<style>' && v !== '<hashA>' && v !== '<hashB>') {
        url.searchParams.set(k, String(v));
      }
    }
  }
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(RECOURSE_API_SECRET ? { Authorization: `Bearer ${RECOURSE_API_SECRET}` } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, reason: `recourse ${method} ${path} -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`, statusCode: res.status };
    }
    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, reason: `recourse ${method} ${path} -> non-JSON response` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// -- Compose surface (src/routes/compose.ts) --------------------------------

export interface ComposeSuggestion {
  style: string;
  seed: number;
  bars: number;
  key?: number;
  major?: boolean;
  bpm?: number;
  [k: string]: unknown;
}

export async function recourseComposeSuggest(style: string, count = 4): Promise<MusicClientResult<{ success: boolean; style: string; suggestions: ComposeSuggestion[] }>> {
  return request('GET', '/api/recourse/compose/suggest', { style, count });
}

export interface ComposeRateInput {
  style: string;
  seed: number;
  rating: number;
  bars?: number;
  key?: number;
  major?: boolean;
  bpm?: number;
  tags?: string[];
  notes?: string;
}

export async function recourseComposeRate(input: ComposeRateInput): Promise<MusicClientResult<{ success: boolean; episode: unknown }>> {
  return request('POST', '/api/recourse/compose/rate', undefined, input);
}

export async function recourseComposeLearned(style?: string): Promise<MusicClientResult<Record<string, unknown>>> {
  return request('GET', '/api/recourse/compose/learned', style ? { style } : undefined);
}

export async function recourseComposeSoundlab(style: string, seed = 1, bars = 8): Promise<MusicClientResult<Record<string, unknown>>> {
  return request('GET', '/api/recourse/compose/soundlab.json', { style, seed, bars });
}

export async function recourseComposeMidi(style: string, seed = 1, bars = 8): Promise<MusicClientResult<ArrayBuffer>> {
  const res = await request<unknown>('GET', '/api/recourse/compose/midi', { style, seed, bars });
  if (!res.ok) return res;
  return { ok: false, reason: 'recourse /compose/midi returns binary; use raw fetch when bytes are required' };
}

// -- Rating surface (src/routes/rating.ts) ----------------------------------

export interface RatingStanding {
  paramHash: string;
  rating: number;
  n: number;
  [k: string]: unknown;
}

export async function recourseRatingStandings(source = 'chordstudio'): Promise<MusicClientResult<{ success: boolean; count: number; standings: RatingStanding[] }>> {
  return request('GET', '/api/recourse/rating/standings', { source });
}

export async function recourseRatingVariations(source = 'chordstudio'): Promise<MusicClientResult<{ success: boolean; variations: unknown[] }>> {
  return request('GET', '/api/recourse/rating/variations', { source });
}

export async function recourseRatingSuggest(source = 'chordstudio', count = 8): Promise<MusicClientResult<Record<string, unknown>>> {
  return request('GET', '/api/recourse/rating/suggest', { source, count });
}

export async function recourseRatingNextPair(source = 'chordstudio'): Promise<MusicClientResult<{ success: boolean; a: unknown; b: unknown }>> {
  return request('GET', '/api/recourse/rating/pair/next', { source });
}

export async function recourseRatingLedger(): Promise<MusicClientResult<Record<string, unknown>>> {
  return request('GET', '/api/recourse/rating/ledger');
}

export interface RatingVariationInput {
  source: string;
  params: Record<string, unknown>;
  paramHash?: string;
  label?: string;
  seedId?: string;
  generation?: number;
  origin?: string;
  createdAt?: number;
}

export async function recourseRatingRegisterVariation(input: RatingVariationInput): Promise<MusicClientResult<{ success: boolean; variation: unknown }>> {
  return request('POST', '/api/recourse/rating/variation', undefined, input);
}

export interface RatingPairInput {
  source: string;
  a: string | Record<string, unknown>;
  b: string | Record<string, unknown>;
  winner: 'A' | 'B';
  pairId?: string;
  sessionId?: string;
  confidence?: 1 | 2 | 3;
  dimensions?: { tags?: string[]; note?: string };
}

export async function recourseRatingRecordPair(input: RatingPairInput): Promise<MusicClientResult<{ success: boolean; choice: unknown }>> {
  return request('POST', '/api/recourse/rating/pair', undefined, input);
}

/** True when a write to the taste surface is even possible (secret configured). */
export function recourseMusicWritesEnabled(): boolean {
  return RECOURSE_API_SECRET.trim() !== '';
}