// ============================================================================
// Chat event bus — lightweight client-side pub/sub
// ============================================================================
// Lets the ChatClient (which persists turns) notify the ConversationSidebar
// (which lists conversations) that the list needs a refresh — no prop drilling
// through layouts, no server round-trip on every token.
// ============================================================================

export type ChatEvent =
  | { type: 'conversation-updated' }
  | { type: 'conversation-deleted'; id: string }
  | { type: 'conversation-created'; id: string };

type Listener = (event: ChatEvent) => void;

const listeners = new Set<Listener>();

export function emitChatEvent(event: ChatEvent): void {
  for (const l of listeners) l(event);
}

export function onChatEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
