import { createHash, randomUUID } from 'crypto';
import type { Task } from './types';

export interface EvidenceEnvelope {
  event_id: string;
  subject_id: string;
  evidence_tier: Task['evidence']['tier'];
  payload_hash: string;
  lineage_parent_ids: string[];
  quality_score: number | undefined;
  timestamp_utc: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

function canonicalPayload(task: Task): Record<string, unknown> {
  // Stable key ordering so JSON.stringify output is deterministic.
  return {
    engine: task.engine,
    inputs: task.inputs,
    result: task.result,
    lineageParentIds: task.evidence.lineageParentIds,
  };
}

export function createEvidenceEnvelope(task: Task): EvidenceEnvelope {
  const payloadHash =
    task.evidence.payloadHash !== undefined && HEX64.test(task.evidence.payloadHash)
      ? task.evidence.payloadHash
      : hashPayload(canonicalPayload(task));
  return {
    event_id: randomUUID(),
    subject_id: task.id,
    evidence_tier: task.evidence.tier,
    payload_hash: payloadHash,
    lineage_parent_ids: task.evidence.lineageParentIds,
    quality_score: task.evidence.qualityScore,
    timestamp_utc: new Date().toISOString(),
  };
}
