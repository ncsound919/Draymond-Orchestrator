/**
 * Additive evidence ledger — an overlay on the learning-store, deliberately
 * NOT coupled to it. The learning-store persists *what* the fleet concluded;
 * this ledger persists *whether we actually know it* (evidence + status), keyed
 * by the learning-store's `lo_`/`ls_` ids.
 *
 * Additive by design: this module never writes learning-store.json and never
 * changes its row shape, so nothing that reads/writes the learning-store can
 * regress. Statuses mirror Comp AI's proposal/settlement lifecycle:
 *
 *   proposed    → strong+primary evidence not yet reached, OR contradicted, OR
 *                 awaiting a human to settle a weak-but-real claim. A proposal
 *                 is not a failure — it is the claim handed to the one person
 *                 who can finish it.
 *   verified    → scored into the verified band from a primary source, or a
 *                 human explicitly settled/accepted a proposal.
 *   superseded  → a later, better-evidenced record for the same conclusion, or
 *                 a human explicitly rejected a proposal.
 *
 * Storage uses the JSON-state registry pattern with a serialized write chain so
 * concurrent writers never corrupt the file (same fix as learning-store.ts).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonState, nowIso } from './cognition';
import {
  scoreConclusion,
  type Evidence,
  type Conclusion,
  type ScoredConclusion,
  type FactBand,
  type FactStatus,
} from './evidence';

export type LedgerRefKind = 'outcome' | 'lesson' | 'discovery' | 'other';

export interface LedgerRecord extends ScoredConclusion {
  refKind: LedgerRefKind;
  evidence: Evidence[];
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
  settledBy?: string;
  settledNote?: string;
  supersededBy?: string;
}

export interface EvidenceLedger {
  records: LedgerRecord[];
  updatedAt: string;
}

export interface SweepSummary {
  proposed: number;
  verified: number;
  superseded: number;
  pruned: number;
}

const STORE_NAME = 'evidence-ledger';
const MAX_RECORDS = 1000;
const DETAIL_CAP = 500;

function capLen(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap) + ' …(truncated)' : s;
}

export function emptyLedger(): EvidenceLedger {
  return { records: [], updatedAt: nowIso() };
}

let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next;
  return next as Promise<T>;
}

function registryDir(): string {
  return process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
}

function recordFile(): string {
  return path.join(registryDir(), `${STORE_NAME}.json`);
}

/**
 * Read the ledger file directly (fail-soft to empty) so this module never
 * couples to `readJsonState`'s registry default resolution quirks.
 */
export async function readLedger(): Promise<EvidenceLedger> {
  try {
    const raw = await fs.readFile(recordFile(), 'utf-8');
    const parsed = JSON.parse(raw) as EvidenceLedger;
    if (parsed && Array.isArray(parsed.records)) return parsed;
    return emptyLedger();
  } catch {
    return emptyLedger();
  }
}

async function writeLedger(ledger: EvidenceLedger): Promise<void> {
  ledger.updatedAt = nowIso();
  await writeJsonState(STORE_NAME, ledger);
}

/**
 * Score a conclusion and persist it to the ledger. Returns the scored record.
 * The status comes from `statusFor`: strong+primary evidence verifies itself;
 * everything else is stored as a proposal for a human to settle.
 */
export function recordEvidence(
  conclusion: Conclusion,
  meta: { recordedBy: string; refKind?: LedgerRefKind },
): Promise<LedgerRecord> {
  return enqueueWrite(async () => {
    const ledger = await readLedger();
    const now = nowIso();
    const capped = {
      ...conclusion,
      subject: capLen(conclusion.subject, 200),
      evidence: conclusion.evidence.map((e) => ({ ...e, detail: capLen(e.detail, DETAIL_CAP) })),
    };
    const scored = scoreConclusion(capped);

    const record: LedgerRecord = {
      ...scored,
      refKind: meta.refKind ?? 'outcome',
      evidence: capped.evidence,
      recordedBy: meta.recordedBy,
      createdAt: now,
      updatedAt: now,
    };

    // Keep one record per (refId, subject). A newer conclusion supersedes the
    // older standing one rather than stacking — same intent as blank-facts.
    const prior = ledger.records.find((r) => r.refId === scored.refId && r.status !== 'superseded');
    ledger.records = ledger.records.filter((r) => !(r.refId === scored.refId && r.status !== 'superseded'));
    if (prior && prior.status === 'verified') {
      record.supersededBy = prior.refId;
    }

    ledger.records.push(record);
    ledger.records = ledger.records.slice(-MAX_RECORDS);
    await writeLedger(ledger);
    return record;
  });
}

/** Human (or trusted operator) settles a proposal. Accept → verified; reject → superseded. */
export function settleRecord(refId: string, decision: { accepted: boolean; by: string; note?: string }): Promise<LedgerRecord | null> {
  return enqueueWrite(async () => {
    const ledger = await readLedger();
    const record = ledger.records.find((r) => r.refId === refId && r.status === 'proposed');
    if (!record) return null;

    record.status = decision.accepted ? 'verified' : 'superseded';
    record.settledBy = decision.by;
    if (decision.note) record.settledNote = capLen(decision.note, 300);
    record.updatedAt = nowIso();
    if (!decision.accepted) record.supersededBy = 'human-rejected';

    await writeLedger(ledger);
    return record;
  });
}

/** Mark a record superseded (e.g. a sweep found newer, better evidence for it). */
export function supersedeRecord(refId: string, by: string): Promise<LedgerRecord | null> {
  return enqueueWrite(async () => {
    const ledger = await readLedger();
    const record = ledger.records.find((r) => r.refId === refId && r.status !== 'superseded');
    if (!record) return null;

    record.status = 'superseded';
    record.supersededBy = by;
    record.updatedAt = nowIso();
    await writeLedger(ledger);
    return record;
  });
}

export async function getRecord(refId: string): Promise<LedgerRecord | undefined> {
  const ledger = await readLedger();
  return ledger.records.find((r) => r.refId === refId && r.status !== 'superseded');
}

export async function listRecords(filter?: { status?: FactStatus; refKind?: LedgerRefKind }): Promise<LedgerRecord[]> {
  const ledger = await readLedger();
  return ledger.records
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .filter((r) => (filter?.refKind ? r.refKind === filter.refKind : true));
}

/**
 * Prune superseded/proposals older than `olderThanMs` and cap total records.
 * Returns counts. Safe to run on any schedule — it never deletes active records.
 */
export async function sweepLedger(options: { olderThanMs?: number } = {}): Promise<SweepSummary> {
  return enqueueWrite(async () => {
    const ledger = await readLedger();
    const cutoff = options.olderThanMs ? Date.now() - options.olderThanMs : Date.now() - 30 * 24 * 3600 * 1000;

    let proposed = 0;
    let verified = 0;
    let superseded = 0;
    const kept: LedgerRecord[] = [];
    let pruned = 0;

    for (const r of ledger.records) {
      if (r.status === 'proposed') proposed++;
      else if (r.status === 'verified') verified++;
      else superseded++;

      const stale = (r.status === 'superseded' || r.status === 'proposed') && new Date(r.updatedAt).getTime() < cutoff;
      if (stale) {
        pruned++;
        continue;
      }
      kept.push(r);
    }

    // Cap to MAX_RECORDS, preferring active over stale.
    const activeFirst = [...kept].sort((a, b) => {
      const rank = { verified: 0, proposed: 1, superseded: 2 } as const;
      return rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank];
    });
    const capped = activeFirst.slice(0, MAX_RECORDS);
    pruned += kept.length - capped.length;

    ledger.records = capped;
    await writeLedger(ledger);
    return { proposed, verified, superseded, pruned };
  });
}

export type { Evidence, FactBand, FactStatus };
