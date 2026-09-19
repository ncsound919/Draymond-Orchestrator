import fs from 'node:fs';
import path from 'node:path';
import { writeBrainFile } from './journal';

/**
 * Repair verification gate (S9): a repair is NOT "done" when it reports
 * success — it is done when the affected service pings healthy N consecutive
 * times within its expected cadence window. Until then the repair sits in
 * `pending` and missed-ping checks escalate instead of closing.
 *
 * Healthchecks-style dead-man-switch, implemented locally:
 *   - register(slug) after a repair reports `fixed`
 *   - POST /api/ping/:slug marks one successful health observation
 *   - sweep() escalates entries that never reached the required streak
 */

// DRAYMOND_REGISTRY_DIR already points AT the .draymond dir (fleet-manifest),
// so it must NOT be joined with another ".draymond" — that nested the gate
// state one level too deep and split it from repair-team-log.json.
const FILE = (): string =>
  path.join(
    process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond'),
    'repair-verification.json'
  );

export interface GateEntry {
  slug: string;
  jobName: string;
  requiredPings: number;
  windowMs: number;
  consecutivePings: number;
  registeredAt: string;
  lastPingAt: string | null;
  status: 'pending' | 'verified' | 'stale';
  verifiedAt: string | null;
}

interface GateState {
  entries: Record<string, GateEntry>;
  updatedAt: string;
}

function readState(): GateState {
  try {
    const raw = fs.readFileSync(FILE(), 'utf-8');
    return JSON.parse(raw) as GateState;
  } catch {
    return { entries: {}, updatedAt: new Date().toISOString() };
  }
}

function writeState(state: GateState): void {
  state.updatedAt = new Date().toISOString();
  writeBrainFile(FILE(), JSON.stringify(state, null, 2), 'write', 'repair-gate');
}

export function registerRepairVerification(
  slug: string,
  jobName: string,
  opts: { requiredPings?: number; windowMs?: number } = {}
): GateEntry {
  const state = readState();
  const entry: GateEntry = {
    slug,
    jobName,
    requiredPings: opts.requiredPings ?? (Number(process.env.DRAYMOND_REPAIR_GATE_PINGS) || 3),
    windowMs: opts.windowMs ?? (Number(process.env.DRAYMOND_REPAIR_GATE_WINDOW_MS) || 15 * 60 * 1000),
    consecutivePings: 0,
    registeredAt: new Date().toISOString(),
    lastPingAt: null,
    status: 'pending',
    verifiedAt: null,
  };
  state.entries[slug] = entry;
  writeState(state);
  return entry;
}

/** One healthy observation. Returns the entry (status may flip to verified). */
export function recordServicePing(slug: string): GateEntry | null {
  const state = readState();
  const entry = state.entries[slug];
  if (!entry || entry.status === 'verified') return entry ?? null;
  if (entry.status === 'stale') return entry;
  entry.consecutivePings += 1;
  entry.lastPingAt = new Date().toISOString();
  if (entry.consecutivePings >= entry.requiredPings) {
    entry.status = 'verified';
    entry.verifiedAt = entry.lastPingAt;
  }
  state.entries[slug] = entry;
  writeState(state);
  return entry;
}

/** A failed health observation resets the streak (repair not holding). */
export function recordServiceFailure(slug: string): GateEntry | null {
  const state = readState();
  const entry = state.entries[slug];
  if (!entry || entry.status !== 'pending') return entry ?? null;
  entry.consecutivePings = 0;
  state.entries[slug] = entry;
  writeState(state);
  return entry;
}

/** Escalate pending entries whose ping window elapsed without enough pings.
 *  Returns the slugs that went stale (callers feed these to escalation). */
export function sweepStaleVerifications(): string[] {
  const state = readState();
  const now = Date.now();
  const stale: string[] = [];
  for (const entry of Object.values(state.entries)) {
    if (entry.status !== 'pending') continue;
    const anchor = entry.lastPingAt ? Date.parse(entry.lastPingAt) : Date.parse(entry.registeredAt);
    if (Number.isNaN(anchor)) continue;
    // Grace: allow one full window per still-needed ping before declaring stale.
    const deadline = anchor + entry.windowMs * Math.max(1, entry.requiredPings - entry.consecutivePings);
    if (now > deadline) {
      entry.status = 'stale';
      stale.push(entry.slug);
    }
  }
  if (stale.length > 0) writeState(state);
  return stale;
}

export function getGateSnapshot(): GateState {
  return readState();
}
