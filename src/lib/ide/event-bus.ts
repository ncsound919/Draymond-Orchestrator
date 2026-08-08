// ============================================================================
// DRAYMOND AGENT IDE — per-session SSE event bus
// ============================================================================
// In-process pub/sub so the session runner and the /api/ide/.../stream route
// share live events without touching the disk. Mirrors the global Open-Chat
// event stream pattern but scoped to one session id.
// ============================================================================

import type { IdeEvent } from './types';

type Writer = {
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => void;
};

const sharedEncoder = new TextEncoder();
const MAX_CLIENTS_PER_SESSION = 20;
const clients = new Map<string, Set<Writer>>();

/**
 * Publish an event to every SSE client subscribed to a session.
 * Safe to call from any route handler or background task. Never throws.
 */
export function publishSessionEvent(sessionId: string, event: IdeEvent): void {
  const set = clients.get(sessionId);
  if (!set || set.size === 0) return;

  const line = `data: ${JSON.stringify(event)}\n\n`;
  const chunk = sharedEncoder.encode(line);
  const dead: Writer[] = [];

  for (const w of set) {
    w.write(chunk).catch(() => dead.push(w));
  }
  for (const w of dead) {
    set.delete(w);
    w.close();
  }
  if (set.size === 0) clients.delete(sessionId);
}

export interface SessionStream {
  stream: ReadableStream<Uint8Array>;
  /** Push raw bytes (e.g. SSE frames) through the same stream. */
  push: (chunk: Uint8Array) => Promise<void>;
  close: () => void;
}

/** Subscribe a reader to a session's live events. Returns the stream + a close handle. */
export function subscribeToSession(sessionId: string): SessionStream {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const w: Writer = {
    write: (chunk) => writer.write(chunk),
    close: () => writer.close().catch(() => undefined),
  };

  if (!clients.has(sessionId)) clients.set(sessionId, new Set());
  const set = clients.get(sessionId)!;
  if (set.size >= MAX_CLIENTS_PER_SESSION) {
    // Refuse new subscribers when a session is oversubscribed; the caller
    // closes the stream immediately on error.
    w.close();
    return { stream: readable, push: (c) => w.write(c), close: () => w.close() };
  }
  set.add(w);

  return {
    stream: readable,
    push: (chunk) => w.write(chunk),
    close: () => {
      set.delete(w);
      w.close();
    },
  };
}
