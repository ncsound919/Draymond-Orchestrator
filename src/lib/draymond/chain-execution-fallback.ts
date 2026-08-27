// ============================================================================
// DRAYMOND ORCHESTRATION — Chain Execution with Deterministic Brain Fallback
// ============================================================================
// Wraps chain execution to detect API token failures and automatically
// escalate to the deterministic brain for task completion.
//
// This layer sits between the repair team and chain execution so failed
// chains can be automatically retried via the deterministic brain without
// requiring human intervention.
// ============================================================================

import { escalateToDeteministicBrain } from './brain-task-fallbacks';
import type { BrainTaskFallbackResult } from './brain-task-fallbacks';
import type { DraymondChain, DraymondChainResult } from './types';

export interface ChainExecutionFallbackOpts {
  /** The chain that failed. */
  chain: DraymondChain;
  /** The original execution error. */
  error: Error | string;
  /** Optional input data from the failed execution. */
  inputData?: Record<string, unknown>;
  /** Maximum retries via brain before giving up. */
  maxBrainRetries?: number;
}

export interface ChainExecutionResult {
  success: boolean;
  chain_id: string;
  chain_name: string;
  output?: unknown;
  fallback_used: boolean;
  brain_result?: BrainTaskFallbackResult;
  error?: string;
  /** Classified root-cause of the original failure (survives the fallback so
   *  the repair team can distinguish "brain stopgap" from "actually fixed"). */
  errorType?: TokenErrorType;
}

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

export enum TokenErrorType {
  MISSING_API_KEY = 'missing_api_key',
  MISSING_OAUTH_TOKEN = 'missing_oauth_token',
  EXPIRED_TOKEN = 'expired_token',
  INVALID_CREDENTIALS = 'invalid_credentials',
  RATE_LIMITED = 'rate_limited',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  /** Chain/entity misconfiguration: missing template, missing URL, SSRF block. */
  CONFIG_ERROR = 'config_error',
  UNKNOWN = 'unknown',
}

/** Classify whether an error is token-related and which type. */
export function classifyTokenError(err: Error | string): TokenErrorType {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes('missing') && (msg.includes('token') || msg.includes('key') || msg.includes('credential'))) {
    if (msg.includes('api')) return TokenErrorType.MISSING_API_KEY;
    if (msg.includes('oauth') || msg.includes('refresh')) return TokenErrorType.MISSING_OAUTH_TOKEN;
    return TokenErrorType.MISSING_API_KEY;
  }

  if (msg.includes('invalid') && (msg.includes('token') || msg.includes('credential'))) {
    return TokenErrorType.INVALID_CREDENTIALS;
  }

  if (msg.includes('expire') || msg.includes('unauthorized')) {
    return TokenErrorType.EXPIRED_TOKEN;
  }

  if (msg.includes('429') || msg.includes('rate')) {
    return TokenErrorType.RATE_LIMITED;
  }

  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('unreachable')) {
    return TokenErrorType.SERVICE_UNAVAILABLE;
  }

  // Configuration failures used to fall through to UNKNOWN and bypass brain
  // escalation entirely — the exact chains that kept failing ("template not
  // found", "invocation_config.url is required", SSRF blocks) are in this
  // class, and the deterministic brain has task-specific handlers for them.
  if (
    msg.includes('not found') ||
    msg.includes('is required') ||
    msg.includes('ssrf blocked') ||
    msg.includes('blocked private')
  ) {
    return TokenErrorType.CONFIG_ERROR;
  }

  return TokenErrorType.UNKNOWN;
}

/** True when the error indicates token/credential issues, service unavailability, or config errors. */
export function isTokenOrServiceError(errorType: TokenErrorType): boolean {
  return (
    errorType === TokenErrorType.MISSING_API_KEY ||
    errorType === TokenErrorType.MISSING_OAUTH_TOKEN ||
    errorType === TokenErrorType.EXPIRED_TOKEN ||
    errorType === TokenErrorType.INVALID_CREDENTIALS ||
    errorType === TokenErrorType.SERVICE_UNAVAILABLE ||
    errorType === TokenErrorType.RATE_LIMITED ||
    errorType === TokenErrorType.CONFIG_ERROR
  );
}

// ============================================================================
// CHAIN EXECUTION WITH FALLBACK
// ============================================================================

/**
 * Execute a chain with automatic fallback to deterministic brain on token/service errors.
 *
 * Flow:
 * 1. Chain executes normally
 * 2. On error:
 *    a. Classify the error (token-related? service down?)
 *    b. If YES → escalate to deterministic brain
 *    c. If NO → return error as-is
 * 3. Brain completes the task deterministically
 * 4. Return result with fallback marker
 */
export async function executeChainWithBrainFallback(
  opts: ChainExecutionFallbackOpts
): Promise<ChainExecutionResult> {
  const chain = opts.chain;
  const errorType = classifyTokenError(opts.error);

  console.log(
    `[chain-fallback] Chain "${chain.name}" failed with error type: ${errorType}`
  );

  // Only escalate on token/service errors
  if (!isTokenOrServiceError(errorType)) {
    return {
      success: false,
      chain_id: chain.id,
      chain_name: chain.name,
      fallback_used: false,
      error: opts.error instanceof Error ? opts.error.message : String(opts.error),
    };
  }

  // Escalate to deterministic brain
  console.log(`[chain-fallback] Escalating chain "${chain.name}" to deterministic brain`);

  const brainResult = await escalateToDeteministicBrain({
    taskName: chain.name,
    failureReason: `${errorType}: ${opts.error instanceof Error ? opts.error.message : String(opts.error)}`,
    inputData: opts.inputData,
    lane: chain.trigger_type === 'schedule' ? 'scheduler' : undefined,
  });

  if (brainResult.success) {
    return {
      success: true,
      chain_id: chain.id,
      chain_name: chain.name,
      output: brainResult.output,
      fallback_used: true,
      brain_result: brainResult,
      errorType,
    };
  } else {
    return {
      success: false,
      chain_id: chain.id,
      chain_name: chain.name,
      fallback_used: true,
      brain_result: brainResult,
      error: brainResult.error ?? 'Deterministic brain failed',
      errorType,
    };
  }
}

// ============================================================================
// REPAIR TEAM INTEGRATION
// ============================================================================

/**
 * Helper: Convert a chain to a repair context for the repair team.
 * Used to record which chains were fixed via deterministic brain.
 */
export function buildRepairContext(
  chain: DraymondChain,
  brainResult: BrainTaskFallbackResult
): Record<string, unknown> {
  return {
    chain_id: chain.id,
    chain_name: chain.name,
    repair_method: 'deterministic_brain',
    brain_confidence: brainResult.brain_confidence ?? 0.85,
    brain_reasoning: brainResult.brain_reasoning ?? 'Deterministic fallback',
    output_available: brainResult.output !== undefined,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// BATCH CHAIN EXECUTOR WITH FALLBACK
// ============================================================================

/**
 * Execute multiple chains in parallel, with brain fallback for failures.
 * Useful for daily batch jobs (morning briefing, daily reports, etc.).
 */
export async function executeChainBatchWithBrainFallback(
  chains: DraymondChain[],
  executor: (chain: DraymondChain) => Promise<DraymondChainResult>,
  opts: { parallelism?: number; continueOnError?: boolean } = {}
): Promise<ChainExecutionResult[]> {
  const parallelism = opts.parallelism ?? 3;
  const continueOnError = opts.continueOnError ?? true;

  const results: ChainExecutionResult[] = [];
  const queue = [...chains];

  while (queue.length > 0) {
    const batch = queue.splice(0, parallelism);
    const batchResults = await Promise.all(
      batch.map(async (chain) => {
        try {
          const result = await executor(chain);
          if (result.success === false) {
            // Chain execution returned an error — escalate to brain
            return executeChainWithBrainFallback({
              chain,
              error: result.error ?? 'Chain execution failed',
              inputData: (result.input_data as Record<string, unknown>) ?? {},
            });
          }
          return {
            success: true,
            chain_id: chain.id,
            chain_name: chain.name,
            output: result.output,
            fallback_used: false,
          } as ChainExecutionResult;
        } catch (err) {
          // Exception during execution — escalate to brain
          return executeChainWithBrainFallback({
            chain,
            error: err instanceof Error ? err : String(err),
          });
        }
      })
    );

    results.push(...batchResults);

    // Stop on first failure if continueOnError is false
    if (!continueOnError && batchResults.some((r) => !r.success)) {
      break;
    }
  }

  return results;
}

// ============================================================================
// STATISTICS & REPORTING
// ============================================================================

export interface BrainFallbackStats {
  total_chains: number;
  successful: number;
  failed: number;
  fallback_used: number;
  fallback_success_rate: number;
  avg_brain_confidence: number;
}

/** Analyze batch execution results for stats and reporting. */
export function analyzeBrainFallbackStats(results: ChainExecutionResult[]): BrainFallbackStats {
  const successful = results.filter((r) => r.success).length;
  const failed = results.length - successful;
  const fallbackUsed = results.filter((r) => r.fallback_used).length;
  const fallbackSuccessful = results.filter((r) => r.fallback_used && r.success).length;

  const brainConfidences = results
    .filter((r) => r.brain_result?.brain_confidence !== undefined)
    .map((r) => r.brain_result!.brain_confidence!);
  const avgConfidence = brainConfidences.length > 0
    ? brainConfidences.reduce((a, b) => a + b, 0) / brainConfidences.length
    : 0;

  return {
    total_chains: results.length,
    successful,
    failed,
    fallback_used: fallbackUsed,
    fallback_success_rate: fallbackUsed > 0 ? fallbackSuccessful / fallbackUsed : 0,
    avg_brain_confidence: avgConfidence,
  };
}
