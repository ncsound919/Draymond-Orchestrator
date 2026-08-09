// ============================================================================
// DRAYMOND — Chat Attachment Storage
// ============================================================================
// Persists chat attachments (images) as files under
// `data/chat-attachments/<conversationId>/` and returns a storage record that
// is placed in the message's `metadata.attachments`. Serving is done through
// the authed `/api/chat/attachments/[conversationId]/[file]` route.
//
// Images are downscaled + re-encoded by the client before upload, so this
// layer only validates, writes, and (optionally) deletes files.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export interface AttachmentInput {
  type: 'image';
  name: string;
  mimeType: string;
  dataB64: string;
}

export interface AttachmentRecord {
  id: string;
  type: 'image';
  name: string;
  mimeType: string;
  size: number;
  url: string;
}

export function attachmentsDir(): string {
  return path.join(process.cwd(), 'data', 'chat-attachments');
}

function conversationDir(conversationId: string): string {
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(attachmentsDir(), safe);
}

/** Validate an attachment; returns an error string or null. */
export function validateAttachment(att: AttachmentInput): string | null {
  if (!att || typeof att !== 'object') return 'Invalid attachment';
  if (att.type !== 'image') return 'Unsupported attachment type';
  if (!ALLOWED_MIME[att.mimeType]) return `Unsupported image type: ${att.mimeType}`;
  const bytes = Buffer.byteLength(att.dataB64 ?? '', 'base64');
  if (bytes === 0) return 'Empty image';
  if (bytes > MAX_IMAGE_BYTES) return 'Image exceeds the 5 MB limit';
  return null;
}

/** Persist an image attachment and return the storage record. */
export async function saveAttachment(
  conversationId: string,
  att: AttachmentInput,
): Promise<AttachmentRecord> {
  const err = validateAttachment(att);
  if (err) throw new Error(err);

  const dir = conversationDir(conversationId);
  fs.mkdirSync(dir, { recursive: true });

  const id = crypto.randomUUID();
  const ext = ALLOWED_MIME[att.mimeType] ?? 'png';
  const filename = `${id}.${ext}`;
  const filePath = path.join(dir, filename);

  const buffer = Buffer.from(att.dataB64, 'base64');
  fs.writeFileSync(filePath, buffer);

  return {
    id,
    type: 'image',
    name: att.name.slice(0, 200) || 'image',
    mimeType: att.mimeType,
    size: buffer.byteLength,
    url: `/api/chat/attachments/${conversationId}/${filename}`,
  };
}

/** Resolve a stored attachment file path, or null when unsafe / missing. */
export function resolveAttachmentFile(
  conversationId: string,
  filename: string,
): string | null {
  // Only plain filenames are allowed — never paths.
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;

  const dir = conversationDir(conversationId);
  const filePath = path.join(dir, filename);

  // Defense in depth: the resolved file must stay inside the conversation dir.
  const relative = path.relative(dir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;

  return filePath;
}

export function lookupMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

/** Remove all attachment files for a conversation (best-effort). */
export function deleteConversationAttachments(conversationId: string): void {
  try {
    const dir = conversationDir(conversationId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
