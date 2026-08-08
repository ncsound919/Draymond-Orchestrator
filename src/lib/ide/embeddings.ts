// ============================================================================
// DRAYMOND AGENT IDE — local embedding adapter (Docker-free)
// ============================================================================
// Provides sentence embeddings for the IDE's hybrid memory (sqlite-vec + FTS5).
// Uses @xenova/transformers with the small all-MiniLM-L6-v2 model, cached in
// process and on disk (~/.cache). Fail-soft: returns null on any failure or
// when disabled, so memory degrades to FTS5-only instead of stalling sessions.
// Enable with IDE_MEMORY_EMBEDDING=1 (the first call downloads the model).
// ============================================================================

const EMBEDDING_ENABLED = process.env.IDE_MEMORY_EMBEDDING === '1' || process.env.IDE_MEMORY_EMBEDDING === 'true';
const MODEL = process.env.IDE_MEMORY_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384;
const FIRST_CALL_TIMEOUT_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelinePromise: Promise<any> | null = null;

export function embeddingsEnabled(): boolean {
  return EMBEDDING_ENABLED;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`embedding timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Embed a batch of texts into normalized 384-dim vectors. Returns null when
 * disabled or on any failure (callers degrade to keyword retrieval).
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!EMBEDDING_ENABLED || texts.length === 0) return null;
  try {
    if (!pipelinePromise) {
      pipelinePromise = import('@xenova/transformers').then((m) =>
        m.pipeline('feature-extraction', MODEL),
      ) as Promise<{ data: Float32Array; dims: number[] }>;
    }
    const pipeline = await withTimeout(pipelinePromise, FIRST_CALL_TIMEOUT_MS);
    const output = (await withTimeout(pipeline(texts, { pooling: 'mean', normalize: true }), 30_000)) as {
      data: Float32Array;
      dims?: number[];
    };
    // output is a Tensor { data: Float32Array, dims: [...] }
    const data = output.data as Float32Array;
    const rows = texts.length;
    const cols = output.dims?.[1] ?? EMBED_DIM;
    const vectors: number[][] = [];
    for (let i = 0; i < rows; i++) {
      vectors.push(Array.from(data.subarray(i * cols, i * cols + cols)));
    }
    return vectors;
  } catch {
    return null;
  }
}
