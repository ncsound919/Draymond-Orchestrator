// ============================================================================
// DRAYMOND — NDJSON Structured I/O Bus
// ============================================================================
// Line-delimited JSON message bus for agent <-> agent and agent <-> bridge
// messaging. Mirrors the CLI structured-IO contract: one JSON message per
// line, safe stringify that never throws on undefined/cycles, and an async
// line splitter for streaming reader loops.
//
// Pure server-side module — no Next.js request context, so it is
// unit-testable and reusable by any route handler.
// ============================================================================

/** True when the value looks like a serializable JSON leaf. */
function isJsonLeaf(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Safe JSON stringify that never throws.
 * - undefined / functions / symbols in object values -> omitted
 * - top-level undefined -> "null"
 * - BigInt -> coerced to Number when lossless, else string
 * - circular references -> replaced with "[Circular]"
 *
 * The output is always valid JSON so downstream `JSON.parse` consumers (the
 * NDJSON reader, the bridge worker, log forwarders) never choke on a line.
 */
export function ndjsonSafeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const replacer = (key: string, val: unknown): unknown => {
    if (typeof val === 'bigint') {
      const num = Number(val);
      return Number.isSafeInteger(num) ? num : val.toString();
    }
    if (typeof val === 'function' || typeof val === 'symbol') {
      return undefined;
    }
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);
    }
    return val;
  };

  try {
    const out = JSON.stringify(value, replacer);
    return out === undefined ? 'null' : out;
  } catch {
    // JSON.stringify with a replacer still throws on pathological inputs
    // (e.g. a toJSON that throws). Fall back to a leaf-only rendering.
    if (isJsonLeaf(value)) {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    }
    return 'null';
  }
}

/** Append a newline and write a single NDJSON line. */
export function ndjsonLine(message: unknown): string {
  return ndjsonSafeStringify(message) + '\n';
}

/** Parse a single NDJSON line. Returns null for blank/comment lines. */
export function ndjsonParseLine(line: string): unknown {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Splits an async iterable (or plain iterable) of string chunks into complete
 * NDJSON lines. Buffers partial lines across chunk boundaries and emits the
 * trailing line on stream end. Skips blank lines and `#` comment lines.
 */
export async function* ndjsonLines(
  input: AsyncIterable<string> | Iterable<string>,
): AsyncGenerator<unknown> {
  let buffer = '';

  for await (const chunk of input) {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const message = ndjsonParseLine(line);
      if (message !== null) yield message;
    }
  }

  // Trailing line without a newline
  if (buffer.trim()) {
    const message = ndjsonParseLine(buffer);
    if (message !== null) yield message;
  }
}
