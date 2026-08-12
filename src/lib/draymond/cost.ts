// ============================================================================
// DRAYMOND ORCHESTRATION SYSTEM — Chain Cost Accounting
// ============================================================================
// Turns chain/step execution into durable cost records + delegation tokens so
// the cost of "everything" is benchmarkable in $ cents.
//
//   - Every executed step gets an estimated token count (input + output text).
//   - Tokens convert to USD cents via a configurable per-token price
//     (DRAYMOND_COST_PER_1M_TOKENS, default $1.50 per 1M — cheap local/Go tier).
//   - A `llm_tokens` cost record is persisted to draymond_cost_records via
//     trackCost (chain_id = chain uuid, step_id = step uuid).
//   - The chain slug's delegation consumption is bumped so the in-memory fleet
//     budget reflects chain work, not just day-orchestrator steps.
// ============================================================================

import { estimateTokens } from '../mathx';
import { trackCost } from './analytics';
import { recordDelegationConsumption } from './delegation';

/** USD cents per 1,000,000 tokens (default $1.50/1M — local/Go free-tier flavored). */
export function costPerMillionTokens(): number {
  const raw = Number(process.env.DRAYMOND_COST_PER_1M_TOKENS ?? 150);
  return Number.isFinite(raw) && raw > 0 ? raw : 150;
}

/** Convert a token count to USD cents. */
export function tokensToCents(tokens: number): number {
  return Math.max(0, Math.round((tokens / 1_000_000) * costPerMillionTokens() * 100) / 100);
}

/** Strip the per-run `-run-<timestamp>` suffix so costs accumulate by chain slug. */
export function normalizeChainSlug(slug: string): string {
  return slug.replace(/-run-\d+$/, '');
}

/** JSON-safe depth-limited stringification for token estimation. */
function textOf(value: unknown): string {  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, (_k, v) => {
        if (typeof v === 'string' && v.length > 2_000) return `${v.slice(0, 2_000)}…`;
        return v;
      });
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Estimate total tokens for a step given its resolved input + output. */
export function estimateStepTokens(input: unknown, output: unknown): number {
  const inputTokens = estimateTokens(textOf(input), 'prose');
  const outputTokens = estimateTokens(textOf(output), 'prose');
  // Add a fixed harness overhead (prompt scaffolding, entity instructions).
  return inputTokens + outputTokens + 512;
}

export interface RecordedStepCost {
  tokens: number;
  costCents: number;
  costType: 'llm_tokens';
}

/**
 * Record cost for one executed chain step. Persists an llm_tokens record and
 * returns the estimated tokens/cents so the chain can roll them up.
 */
export async function recordChainStepCost(
  chainId: string,
  chainSlug: string,
  stepId: string,
  stepName: string,
  entityId: string,
  input: unknown,
  output: unknown,
): Promise<RecordedStepCost> {
  const tokens = estimateStepTokens(input, output);
  const costCents = tokensToCents(tokens);
  const baseSlug = normalizeChainSlug(chainSlug);

  await trackCost({
    entity_id: entityId,
    chain_id: chainId,
    step_id: stepId,
    cost_type: 'llm_tokens',
    amount_cents: costCents,
    unit_count: tokens,
    unit_label: 'tokens',
    metadata: {
      chain_slug: chainSlug,
      chain_slug_base: baseSlug,
      step_name: stepName,
      estimated_tokens: tokens,
      estimated: true,
    },
  });

  // Charge the chain slug against the fleet delegation budget too, so chain
  // work shows up alongside day-orchestrator steps in /api/ops/delegation.
  recordDelegationConsumption(baseSlug, tokens);

  return { tokens, costCents, costType: 'llm_tokens' };
}
