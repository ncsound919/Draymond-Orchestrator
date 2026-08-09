import { beforeEach, describe, expect, it } from 'vitest';

// Force the local DB to in-memory for these tests (read lazily by getDb).
process.env.DRAYMOND_DB_PATH = ':memory:';

import { getDb } from '../src/lib/db/connection';
import {
  appendMessages,
  autoTitleConversation,
  createConversation,
  deleteConversation,
  deleteMessagesAfter,
  deriveTitle,
  getConversation,
  listConversations,
  listMessages,
  nextSeq,
  renameConversation,
} from '../src/lib/draymond/chat-store';

const USER = 'user-1';
const OTHER_USER = 'user-2';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM draymond_messages; DELETE FROM draymond_conversations;');
});

describe('conversations', () => {
  it('creates and loads a conversation scoped to the user', async () => {
    const conv = await createConversation(USER, { title: 'My chat' });
    expect(conv.title).toBe('My chat');
    expect(conv.user_id).toBe(USER);
    expect(conv.id).toBeTruthy();

    const loaded = await getConversation(conv.id, USER);
    expect(loaded?.id).toBe(conv.id);
    expect(loaded?.title).toBe('My chat');

    // Another user cannot see it.
    expect(await getConversation(conv.id, OTHER_USER)).toBeNull();
  });

  it('renames a conversation only for the owner', async () => {
    const conv = await createConversation(USER);
    const renamed = await renameConversation(conv.id, USER, '  New title  ');
    expect(renamed?.title).toBe('New title');

    expect(await renameConversation(conv.id, OTHER_USER, 'nope')).toBeNull();
    expect((await getConversation(conv.id, USER))?.title).toBe('New title');
  });

  it('deletes a conversation and its transcript', async () => {
    const conv = await createConversation(USER);
    await appendMessages(conv.id, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);

    expect(await deleteConversation(conv.id, OTHER_USER)).toBe(false);
    expect(await getConversation(conv.id, USER)).not.toBeNull();

    expect(await deleteConversation(conv.id, USER)).toBe(true);
    expect(await getConversation(conv.id, USER)).toBeNull();
    expect(await listMessages(conv.id)).toHaveLength(0);
  });

  it('lists conversations newest-first with preview + message count', async () => {
    const a = await createConversation(USER);
    await sleep(5);
    const b = await createConversation(USER);

    await appendMessages(a.id, [
      { role: 'user', content: 'first message of chat A' },
      { role: 'assistant', content: 'reply A' },
    ]);
    await sleep(5);
    await appendMessages(b.id, [{ role: 'user', content: 'only message of B' }]);

    const list = await listConversations(USER);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id);
    expect(list[0].preview).toContain('only message of B');
    expect(list[0].message_count).toBe(1);

    expect(list[1].id).toBe(a.id);
    expect(list[1].preview).toContain('reply A');
    expect(list[1].message_count).toBe(2);

    expect(await listConversations(OTHER_USER)).toHaveLength(0);
  });
});

describe('messages', () => {
  it('appends messages with sequential order and metadata', async () => {
    const conv = await createConversation(USER);
    const first = await appendMessages(conv.id, [{ role: 'user', content: 'hi', metadata: { attachments: [{ id: 'a1' }] } }]);
    expect(first[0].seq).toBe(1);
    expect(first[0].metadata).toEqual({ attachments: [{ id: 'a1' }] });

    const second = await appendMessages(conv.id, [
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ]);
    expect(second.map((m) => m.seq)).toEqual([2, 3]);
    expect(await nextSeq(conv.id)).toBe(4);

    const all = await listMessages(conv.id);
    expect(all.map((m) => m.content)).toEqual(['hi', 'hello', 'again']);
  });

  it('appends at the tail even when ids are provided', async () => {
    const conv = await createConversation(USER);
    await appendMessages(conv.id, [{ role: 'user', content: 'one', id: 'custom-id' }]);
    const all = await listMessages(conv.id);
    expect(all[0].id).toBe('custom-id');
    expect(all[0].seq).toBe(1);
  });

  it('truncates from a given message onward (edit/regenerate)', async () => {
    const conv = await createConversation(USER);
    const [u1, a1, u2] = await appendMessages(conv.id, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer 1' },
      { role: 'user', content: 'second' },
    ]);

    expect(await deleteMessagesAfter(conv.id, u1.id, OTHER_USER)).toBe(false);

    const ok = await deleteMessagesAfter(conv.id, a1.id, USER);
    expect(ok).toBe(true);
    const remaining = await listMessages(conv.id);
    expect(remaining.map((m) => m.content)).toEqual(['first']);

    // Deleting from a nonexistent message fails safely.
    expect(await deleteMessagesAfter(conv.id, 'missing-id', USER)).toBe(false);

    // u2 was removed; its seq can be reused by the next append.
    void u2;
  });

  it('auto-titles from the first user message', async () => {
    const conv = await createConversation(USER);
    expect(deriveTitle('  launch the   new product tomorrow  ')).toBe('launch the new product tomorrow');

    await autoTitleConversation(conv.id, USER, 'Tell me about the market analysis for Q3');
    expect((await getConversation(conv.id, USER))?.title).toBe('Tell me about the market analysis for Q3');

    // A second message does not overwrite a custom title.
    await autoTitleConversation(conv.id, USER, 'ignored');
    expect((await getConversation(conv.id, USER))?.title).toBe('Tell me about the market analysis for Q3');
  });
});
