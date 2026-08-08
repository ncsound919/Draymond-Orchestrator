/**
 * Token estimation and text utilities.
 * Ported from @mathx/math-core/src/tokenizer.ts.
 *
 * These are intentionally lightweight approximations — not a full tokenizer.
 * They exist to help route requests (e.g. truncate context to fit a budget)
 * without the overhead of loading tiktoken or a full cl100k encoder.
 */

/**
 * Estimate the number of tokens in a string using a simple word-based heuristic.
 * Calibrated against cl100k (GPT-4/Claude): ~1.3 tokens per English word on
 * average, with code/math typically running higher (~1.5-2 tokens per word).
 *
 * @param text - Input string
 * @param mode - 'prose' uses 1.3×, 'code' uses 1.7×, 'math' uses 2.0×
 * @returns    Approximate token count (integer)
 */
export function estimateTokens(
  text: string,
  mode: 'prose' | 'code' | 'math' = 'prose',
): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const multipliers = { prose: 1.3, code: 1.7, math: 2.0 } as const;
  return Math.ceil(words * multipliers[mode]);
}

/**
 * Truncate a string to approximately `maxTokens` tokens.
 * Preserves whole words. Appends `suffix` when truncated (default: '…').
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  mode: 'prose' | 'code' | 'math' = 'prose',
  suffix = '…',
): string {
  if (estimateTokens(text, mode) <= maxTokens) return text;
  const words = text.split(/\s+/);
  const multipliers = { prose: 1.3, code: 1.7, math: 2.0 } as const;
  const maxWords = Math.floor(maxTokens / multipliers[mode]);
  return words.slice(0, maxWords).join(' ') + suffix;
}

/**
 * Split a long document into chunks of at most `chunkTokens` tokens,
 * with `overlapTokens` tokens of context preserved between chunks.
 * Used by the RAG ingestion pipeline.
 */
export function chunkText(
  text: string,
  chunkTokens = 512,
  overlapTokens = 64,
  mode: 'prose' | 'code' | 'math' = 'prose',
): string[] {
  const words = text.split(/\s+/);
  const multipliers = { prose: 1.3, code: 1.7, math: 2.0 } as const;
  const chunkWords = Math.floor(chunkTokens / multipliers[mode]);
  const overlapWords = Math.floor(overlapTokens / multipliers[mode]);

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
    start = end - overlapWords;
  }
  return chunks;
}

/**
 * Return the detected content mode for a code block string.
 * Used to pick the right token multiplier when chunking mixed content.
 */
export function detectContentMode(text: string): 'prose' | 'code' | 'math' {
  const mathIndicators = /\\frac|\\sum|\\int|\\partial|\\nabla|\$\$|\\\[/;
  const codeIndicators = /```|def |function |import |class |const |let |var /;
  if (mathIndicators.test(text)) return 'math';
  if (codeIndicators.test(text)) return 'code';
  return 'prose';
}
