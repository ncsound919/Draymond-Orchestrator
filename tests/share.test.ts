import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyShareLink,
  decodeSessionFromURL,
  encodeSessionToURL,
  type ShareableSession,
} from '../src/lib/mathx/share';

const SESSION: ShareableSession = {
  messages: [
    { role: 'user', content: 'Simplify this equation' },
    { role: 'assistant', content: 'x = 2' },
  ],
  mode: 'algebra',
};

async function deflateRaw(s: string): Promise<string> {
  const data = new TextEncoder().encode(s);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  void writer.write(data);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return btoa(String.fromCharCode(...merged));
}

let location: { href: string; hash: string; pathname: string; search: string };
let replaceState: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  location = { href: 'https://uplift.ai/math-lab?tab=1', hash: '', pathname: '/math-lab', search: '?tab=1' };
  replaceState = vi.fn();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window', { location });
  vi.stubGlobal('history', { replaceState });
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('math lab session sharing', () => {
  it('round-trips a session through the URL hash', async () => {
    const url = await encodeSessionToURL(SESSION);
    expect(url.startsWith('https://uplift.ai/math-lab?tab=1')).toBe(true);
    expect(url).toContain('#session=');
    location.hash = url.slice(url.indexOf('#'));
    expect(await decodeSessionFromURL()).toEqual(SESSION);
    // success clears the hash via history.replaceState
    expect(replaceState).toHaveBeenCalledWith(null, '', '/math-lab?tab=1');
  });

  it('round-trips a large session across chunked binary conversion', async () => {
    const big: ShareableSession = { messages: [{ role: 'user', content: '📐'.repeat(40_000) }], mode: 'geometry' };
    const url = await encodeSessionToURL(big);
    location.hash = url.slice(url.indexOf('#'));
    expect(await decodeSessionFromURL()).toEqual(big);
  });

  it('returns null when no session hash is present', async () => {
    expect(await decodeSessionFromURL()).toBeNull();
    location.hash = '#other=1';
    expect(await decodeSessionFromURL()).toBeNull();
    location.hash = '#session=';
    expect(await decodeSessionFromURL()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('returns null on malformed base64, invalid JSON and bad URI encoding', async () => {
    location.hash = '#session=!!!not-base64!!!';
    expect(await decodeSessionFromURL()).toBeNull();

    location.hash = '#session=' + encodeURIComponent(await deflateRaw('this is not json'));
    expect(await decodeSessionFromURL()).toBeNull();

    location.hash = '#session=%E0%A4%A';
    expect(await decodeSessionFromURL()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('round-trips empty and non-object inputs gracefully', async () => {
    const url = await encodeSessionToURL({ messages: [], mode: '' });
    location.hash = url.slice(url.indexOf('#'));
    expect(await decodeSessionFromURL()).toEqual({ messages: [], mode: '' });

    const url2 = await encodeSessionToURL('plain string' as never);
    location.hash = url2.slice(url2.indexOf('#'));
    expect(await decodeSessionFromURL()).toBe('plain string');

    await expect(encodeSessionToURL(undefined as never)).resolves.toContain('#session=');
  });

  it('copyShareLink writes the encoded URL to the clipboard', async () => {
    await copyShareLink(SESSION);
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0]![0] as string;
    expect(written).toContain('#session=');
    location.hash = written.slice(written.indexOf('#'));
    expect(await decodeSessionFromURL()).toEqual(SESSION);
  });
});
