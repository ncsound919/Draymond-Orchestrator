import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  attachmentsDir,
  validateAttachment,
  saveAttachment,
  resolveAttachmentFile,
  lookupMimeType,
  deleteConversationAttachments,
} from '../src/lib/draymond/chat-attachments';
import type { AttachmentInput } from '../src/lib/draymond/chat-attachments';

// chat-attachments.ts writes under process.cwd()/data/chat-attachments with no
// env override, so every test creates + cleans the real directory it uses.

function cleanAttachments(): void {
  const dir = attachmentsDir();
  if (path.basename(dir) === 'chat-attachments') {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanAttachments();
});

afterEach(() => {
  cleanAttachments();
});

const base: AttachmentInput = { type: 'image', name: 'pic.png', mimeType: 'image/png', dataB64: 'aGk=' };

describe('attachmentsDir', () => {
  it('points at <cwd>/data/chat-attachments', () => {
    expect(attachmentsDir()).toBe(path.join(process.cwd(), 'data', 'chat-attachments'));
  });
});

describe('validateAttachment', () => {
  it('rejects non-objects', () => {
    expect(validateAttachment(null as unknown as AttachmentInput)).toBe('Invalid attachment');
    expect(validateAttachment(undefined as unknown as AttachmentInput)).toBe('Invalid attachment');
    expect(validateAttachment('x' as unknown as AttachmentInput)).toBe('Invalid attachment');
  });

  it('rejects unsupported types and mime types', () => {
    expect(validateAttachment({ ...base, type: 'video' } as unknown as AttachmentInput)).toBe('Unsupported attachment type');
    expect(validateAttachment({ ...base, mimeType: 'image/bmp' })).toBe('Unsupported image type: image/bmp');
    expect(validateAttachment({ ...base, mimeType: '' })).toBe('Unsupported image type: ');
  });

  it('rejects empty and oversized payloads', () => {
    expect(validateAttachment({ ...base, dataB64: '' })).toBe('Empty image');
    expect(validateAttachment({ ...base, dataB64: undefined as unknown as string })).toBe('Empty image');
    const over = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
    expect(validateAttachment({ ...base, dataB64: over })).toBe('Image exceeds the 5 MB limit');
  });

  it('accepts the supported mime types, including exactly 5 MB', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      expect(validateAttachment({ ...base, mimeType: mime })).toBeNull();
    }
    const exact = Buffer.alloc(5 * 1024 * 1024).toString('base64');
    expect(validateAttachment({ ...base, dataB64: exact })).toBeNull();
  });
});

describe('saveAttachment', () => {
  it('persists the file and returns a storage record', async () => {
    const data = Buffer.from('hello attachment bytes');
    const rec = await saveAttachment('conv-123', { type: 'image', name: 'shot.png', mimeType: 'image/png', dataB64: data.toString('base64') });
    expect(rec.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(rec.type).toBe('image');
    expect(rec.name).toBe('shot.png');
    expect(rec.mimeType).toBe('image/png');
    expect(rec.size).toBe(data.byteLength);
    expect(rec.url).toBe(`/api/chat/attachments/conv-123/${rec.id}.png`);
    const filePath = resolveAttachmentFile('conv-123', `${rec.id}.png`);
    expect(filePath).toBe(path.join(attachmentsDir(), 'conv-123', `${rec.id}.png`));
    expect(fs.readFileSync(filePath!)).toEqual(data);
  });

  it('throws the validation error for invalid input', async () => {
    await expect(
      saveAttachment('c', { type: 'image', name: 'x', mimeType: 'image/bmp', dataB64: 'aGk=' }),
    ).rejects.toThrow('Unsupported image type: image/bmp');
    await expect(
      saveAttachment('c', { type: 'image', name: 'x', mimeType: 'image/png', dataB64: '' }),
    ).rejects.toThrow('Empty image');
  });

  it('maps the mime type to the file extension', async () => {
    const jpeg = await saveAttachment('c', { type: 'image', name: 'a', mimeType: 'image/jpeg', dataB64: 'aGk=' });
    expect(jpeg.url).toBe(`/api/chat/attachments/c/${jpeg.id}.jpg`);
    const webp = await saveAttachment('c', { type: 'image', name: 'a', mimeType: 'image/webp', dataB64: 'aGk=' });
    expect(webp.url).toBe(`/api/chat/attachments/c/${webp.id}.webp`);
    const gif = await saveAttachment('c', { type: 'image', name: 'a', mimeType: 'image/gif', dataB64: 'aGk=' });
    expect(gif.url).toBe(`/api/chat/attachments/c/${gif.id}.gif`);
  });

  it('sanitizes the conversation id for the filesystem but keeps it in the url', async () => {
    const rec = await saveAttachment('weird/..id!!', { type: 'image', name: 'a', mimeType: 'image/png', dataB64: 'aGk=' });
    expect(fs.existsSync(path.join(attachmentsDir(), 'weirdid', `${rec.id}.png`))).toBe(true);
    expect(rec.url).toBe(`/api/chat/attachments/weird/..id!!/${rec.id}.png`);
  });

  it('truncates long names to 200 chars and defaults empty names to image', async () => {
    const a = await saveAttachment('c', { type: 'image', name: 'n'.repeat(250), mimeType: 'image/png', dataB64: 'aGk=' });
    expect(a.name).toHaveLength(200);
    const b = await saveAttachment('c', { type: 'image', name: '', mimeType: 'image/png', dataB64: 'aGk=' });
    expect(b.name).toBe('image');
  });
});

describe('resolveAttachmentFile', () => {
  it('returns the path for an existing file and null when missing', async () => {
    const rec = await saveAttachment('conv-1', { type: 'image', name: 'x', mimeType: 'image/png', dataB64: 'aGk=' });
    expect(resolveAttachmentFile('conv-1', `${rec.id}.png`)).toBe(path.join(attachmentsDir(), 'conv-1', `${rec.id}.png`));
    expect(resolveAttachmentFile('conv-1', 'nope.png')).toBeNull();
  });

  it('rejects path-like filenames outright', () => {
    expect(resolveAttachmentFile('conv-1', '../escape.png')).toBeNull();
    expect(resolveAttachmentFile('conv-1', 'a/b.png')).toBeNull();
    expect(resolveAttachmentFile('conv-1', 'a\\b.png')).toBeNull();
    expect(resolveAttachmentFile('conv-1', '/etc/passwd')).toBeNull();
    expect(resolveAttachmentFile('conv-1', '..')).toBeNull();
  });

  it('rejects directories even when they exist', () => {
    fs.mkdirSync(path.join(attachmentsDir(), 'conv-1', 'sub'), { recursive: true });
    expect(resolveAttachmentFile('conv-1', 'sub')).toBeNull();
  });

  it('sanitizes the conversation id like saveAttachment does', async () => {
    const rec = await saveAttachment('conv~!1', { type: 'image', name: 'x', mimeType: 'image/png', dataB64: 'aGk=' });
    expect(resolveAttachmentFile('conv~!1', `${rec.id}.png`)).toBe(path.join(attachmentsDir(), 'conv1', `${rec.id}.png`));
  });
});

describe('lookupMimeType', () => {
  it('maps known extensions case-insensitively', () => {
    expect(lookupMimeType('a.png')).toBe('image/png');
    expect(lookupMimeType('a.jpg')).toBe('image/jpeg');
    expect(lookupMimeType('a.jpeg')).toBe('image/jpeg');
    expect(lookupMimeType('a.WEBP')).toBe('image/webp');
    expect(lookupMimeType('a.gif')).toBe('image/gif');
  });

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(lookupMimeType('a.txt')).toBe('application/octet-stream');
    expect(lookupMimeType('noext')).toBe('application/octet-stream');
    expect(lookupMimeType('a.tar.gz')).toBe('application/octet-stream');
  });
});

describe('deleteConversationAttachments', () => {
  it('removes the whole conversation directory', async () => {
    await saveAttachment('conv-9', { type: 'image', name: 'a', mimeType: 'image/png', dataB64: 'aGk=' });
    await saveAttachment('conv-9', { type: 'image', name: 'b', mimeType: 'image/webp', dataB64: 'aGk=' });
    expect(fs.existsSync(path.join(attachmentsDir(), 'conv-9'))).toBe(true);
    deleteConversationAttachments('conv-9');
    expect(fs.existsSync(path.join(attachmentsDir(), 'conv-9'))).toBe(false);
    expect(fs.existsSync(attachmentsDir())).toBe(true); // root survives
  });

  it('is a best-effort no-op for unknown conversations', () => {
    expect(() => deleteConversationAttachments('never-existed')).not.toThrow();
  });
});

describe('attachment lifecycle', () => {
  it('supports the full save → resolve → delete flow', async () => {
    const rec = await saveAttachment('lc', { type: 'image', name: 'x', mimeType: 'image/jpeg', dataB64: Buffer.from('jpeg bytes').toString('base64') });
    expect(resolveAttachmentFile('lc', `${rec.id}.jpg`)).not.toBeNull();
    deleteConversationAttachments('lc');
    expect(resolveAttachmentFile('lc', `${rec.id}.jpg`)).toBeNull();
  });
});
