/**
 * URL-based Math Lab session sharing using native CompressionStream + base64.
 * Zero server required — the session rides in the URL hash.
 * Ported from @mathx/web (utils/shareSession.ts).
 */
'use client';

async function compress(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  // Chunked binary→string: String.fromCharCode(...huge) blows the call-stack
  // argument limit (~65k) on large sessions.
  let binary = '';
  for (let i = 0; i < merged.length; i += 0x8000) {
    binary += String.fromCharCode(...merged.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function decompress(b64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

export interface ShareableSession {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode: string;
}

export async function encodeSessionToURL(session: ShareableSession): Promise<string> {
  const encoded = await compress(JSON.stringify(session));
  const url = new URL(window.location.href);
  url.hash = `session=${encodeURIComponent(encoded)}`;
  return url.toString();
}

export async function decodeSessionFromURL(): Promise<ShareableSession | null> {
  const hash = window.location.hash;
  const match = hash.match(/session=([^&]+)/);
  if (!match) return null;
  try {
    const encoded = decodeURIComponent(match[1]);
    const session = JSON.parse(await decompress(encoded)) as ShareableSession;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return session;
  } catch {
    return null;
  }
}

export async function copyShareLink(session: ShareableSession): Promise<void> {
  const url = await encodeSessionToURL(session);
  await navigator.clipboard.writeText(url);
}
