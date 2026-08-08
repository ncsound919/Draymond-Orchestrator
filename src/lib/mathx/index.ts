/**
 * @/lib/mathx — the embedded Math X core.
 *
 * Pure TypeScript, zero runtime dependencies. Consumed by the Draymond
 * orchestration core (confidence, deterministic brain, day orchestrator, LLM
 * budget) and — later — by the /math lab and client workers.
 *
 * Ported from @mathx/math-core (see docs/mathx-source-reference).
 */
export * from './types';
export {
  estimateTokens,
  truncateToTokens,
  chunkText,
  detectContentMode,
} from './tokenizer';
export {
  parseVerifySteps,
  computeSummary,
  buildSymPyVerificationCode,
  type DerivationStep,
  type AnnotatedStep,
  type VerificationSummary,
} from './verify';
export {
  MATHX_SYSTEM,
  MODE_PREFIXES,
  buildPrompt,
  buildRetrievedContextBlock,
  buildExecutionBlock,
} from './prompts';
export {
  DOMAIN_SYSTEM_PROMPTS,
  PROOF_ASSISTANT_PROMPT,
  getDomainPrompt,
} from './domainPrompts';
export {
  preferredProviderForMode,
  checkOllamaHealth,
  MODE_MAX_TOKENS,
  maxTokensForMode,
  type MathProvider,
} from './router';
export {
  percentile,
  betaPosterior,
  shrinkage,
  ewma,
  cusum,
  normalCdf,
  sigmoid,
  type BetaPosterior,
  type CusumAlarm,
} from './stats';
export {
  rankByExpectedValue,
  costAwareOrder,
  type EvItem,
  type CostAwareJob,
} from './optimize';
