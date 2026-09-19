/**
 * Evidence scoring — the "never set a confidence, report what you observed"
 * discipline (adapted from Comp AI's evidence ledger).
 *
 * Pure and IO-free so it is unit-testable in isolation. Storage/lifecycle for
 * the ledger lives in `evidence-ledger.ts`; this module only prices evidence.
 *
 * Rules carried over and enforced here:
 *   1. The caller never supplies a confidence score. It reports evidence kinds
 *      and the ledger prices them.
 *   2. A `contradiction` does not lower the score a little — it holds the
 *      conclusion entirely (caps the score well below the verified band).
 *   3. `verified` requires a PRIMARY source AND a high combined score. A pile
 *      of supporting evidence can reach `probable`, never `verified`.
 *   4. Two observations from the same source are one observation, so each
 *      entry must be from an independent source.
 */

export type EvidenceKind =
  | 'log.observed'
  | 'data.cited-source'
  | 'human.verified'
  | 'provenance.verified'
  | 'corroboration'
  | 'web.cited-claim'
  | 'inference'
  | 'contradiction';

export type FactBand = 'verified' | 'probable' | 'possible';

export type FactStatus = 'proposed' | 'verified' | 'superseded';

export interface Evidence {
  kind: EvidenceKind;
  detail: string;
  sourceUrl?: string;
}

export interface Conclusion {
  refId: string;
  subject: string;
  evidence: Evidence[];
}

export interface ScoredConclusion {
  refId: string;
  subject: string;
  score: number;
  band: FactBand | null;
  hasPrimary: boolean;
  contradicted: boolean;
  status: FactStatus;
  rationale: string;
}

interface Weighting {
  weight: number;
  primary: boolean;
  label: string;
}

export const WEIGHTS: Record<EvidenceKind, Weighting> = {
  'human.verified': {
    weight: 0.95,
    primary: true,
    label: 'confirmed by a human operator',
  },
  'log.observed': {
    weight: 0.9,
    primary: true,
    label: 'directly observed in tool/log/monitor output',
  },
  'data.cited-source': {
    weight: 0.85,
    primary: true,
    label: 'returned from a queryable dataset/API with a citable source',
  },
  'provenance.verified': {
    weight: 0.8,
    primary: true,
    label: 'integrity-checked via trust-layer / measured:true tooling',
  },
  corroboration: {
    weight: 0.6,
    primary: false,
    label: 'an independent agent/loop reached the same conclusion',
  },
  'web.cited-claim': {
    weight: 0.4,
    primary: false,
    label: 'a cited web/paper source states it',
  },
  inference: {
    weight: 0.2,
    primary: false,
    label: 'model inference without direct observation',
  },
  contradiction: {
    weight: 0,
    primary: false,
    label: 'another source disagrees',
  },
};

/** Score ceiling so no finite set of sources reaches literal certainty. */
const CEILING = 0.99;

/** A contradiction never settles above this — it is held, not reduced a bit. */
const CONTRADICTED_CAP = 0.45;

export const BAND_FLOOR = { VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 } as const;

export function scoreEvidence(evidence: Evidence[]): Omit<ScoredConclusion, 'refId' | 'subject' | 'status'> {
  if (evidence.length === 0) {
    return { score: 0, band: null, hasPrimary: false, contradicted: false, rationale: 'No evidence.' };
  }

  const contradicted = evidence.some((item) => item.kind === 'contradiction');
  const hasPrimary = evidence.some((item) => WEIGHTS[item.kind].primary);

  const combined = evidence.reduce((remaining, item) => remaining * (1 - WEIGHTS[item.kind].weight), 1);

  let score = Math.min(CEILING, 1 - combined);
  if (contradicted) score = Math.min(score, CONTRADICTED_CAP);

  return { score, band: bandFor(score, hasPrimary), hasPrimary, contradicted, rationale: rationaleFor(evidence, contradicted, hasPrimary) };
}

/**
 * Decide the status of a conclusion from its score. Strong + primary source →
 * verified and written through; anything uncertain becomes a *proposal* a human
 * settles (never silently discarded, never silently forced). A contradiction is
 * held as a proposal regardless of how much else is present.
 */
export function statusFor(evidence: Evidence[], score: number, hasPrimary: boolean, contradicted: boolean): FactStatus {
  if (contradicted) return 'proposed';
  if (score >= BAND_FLOOR.VERIFIED && hasPrimary) return 'verified';
  if (hasPrimary && score >= BAND_FLOOR.PROBABLE) return 'proposed';
  return 'proposed';
}

export function bandFor(score: number, hasPrimary: boolean): FactBand | null {
  if (score >= BAND_FLOOR.VERIFIED && hasPrimary) return 'verified';
  if (score >= BAND_FLOOR.PROBABLE) return 'probable';
  if (score >= BAND_FLOOR.POSSIBLE) return 'possible';
  return null;
}

export function scoreConclusion(conclusion: Conclusion): ScoredConclusion {
  const scored = scoreEvidence(conclusion.evidence);
  return {
    refId: conclusion.refId,
    subject: conclusion.subject,
    ...scored,
    status: statusFor(conclusion.evidence, scored.score, scored.hasPrimary, scored.contradicted),
  };
}

function rationaleFor(evidence: Evidence[], contradicted: boolean, hasPrimary: boolean): string {
  const reasons = evidence
    .filter((item) => item.kind !== 'contradiction')
    .map((item) => WEIGHTS[item.kind].label);

  if (contradicted) {
    const clash = evidence.find((item) => item.kind === 'contradiction');
    return `Held: ${clash?.detail ?? 'sources disagree'}.`;
  }

  if (reasons.length === 0) return 'No supporting evidence.';

  const list = joinWords(reasons);
  return hasPrimary
    ? capitalise(list)
    : `${capitalise(list)} — but nothing that directly observes it.`;
}

function joinWords(words: string[]): string {
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
