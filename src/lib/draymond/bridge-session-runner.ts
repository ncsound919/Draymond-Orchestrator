// ============================================================================
// DRAYMOND — Bridge Session Runner
// ============================================================================
// Executes a bridge session by running a Draymond chat turn against the
// orchestrator's conversational brain (orchestrateChatTurn) and streaming the
// assistant's reply back into the session as events. This is what "running a
// session" means on the Draymond side: the Open-Chat worker polls for work,
// acks, then hands the user message to Draymond via a session event; this
// runner picks it up, runs the turn, and appends the assistant response.
//
// Pure server-side module — no Next.js request context, so it is
// unit-testable. `orchestrateChatTurn` is imported lazily to keep the bridge
// store testable without pulling the whole chat tree.
// ============================================================================

import type { BridgeStore, SessionEvent } from './bridge-server';
import type { ChatMessage } from './chat';

export interface SessionTurnOptions {
  /** Text of the user message that triggered the turn. */
  task: string;
  /** Prior transcript from the session (assistant + user events). */
  conversation?: ChatMessage[];
  metadata?: Record<string, unknown>;
}

export interface SessionTurnResult {
  result: string;
  status: 'completed' | 'failed';
}

/**
 * Run one Draymond chat turn and append the assistant reply to the bridge
 * session's event log. Streams chunks as 'assistant' events so a remote
 * worker can render partial output.
 */
export async function runBridgeSessionTurn(
  store: BridgeStore,
  environmentId: string,
  sessionId: string,
  sessionToken: string,
  options: SessionTurnOptions,
): Promise<SessionTurnResult> {
  const { orchestrateChatTurn } = await import('./chat');

  const streamEvents: SessionEvent[] = [];
  const flushEvents = () => {
    for (const ev of streamEvents.splice(0, streamEvents.length)) {
      store.appendSessionEvent(environmentId, sessionId, sessionToken, ev);
    }
  };

  const result = await orchestrateChatTurn({
    task: options.task,
    conversation: options.conversation ?? [],
    metadata: {
      source: 'bridge-session',
      environment_id: environmentId,
      session_id: sessionId,
      ...(options.metadata ?? {}),
    },
    onChunk: (chunk) => {
      streamEvents.push({ type: 'assistant', content: chunk, timestamp: Date.now() });
      // Flush eagerly so remote workers get partial output without waiting
      // for the turn to complete.
      if (streamEvents.length >= 10) flushEvents();
    },
  });

  flushEvents();
  // Persist the final assistant message as a single coalesced event.
  if (result.result) {
    store.appendSessionEvent(environmentId, sessionId, sessionToken, {
      type: 'result',
      content: result.result,
      summary: result.result.slice(0, 200),
      timestamp: Date.now(),
      metadata: {
        status: result.status,
        route: result.route?.intent,
        entity_slug: result.entity_slug,
        chain_slug: result.chain_slug,
      },
    });
  }

  return {
    result: result.result,
    status: result.status === 'error' ? 'failed' : 'completed',
  };
}
