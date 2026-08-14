/**
 * Google OAuth 2 helper — token load/refresh for Google Workspace tools.
 *
 * The refresh token is obtained ONCE via the consent script (google-consent.mjs)
 * using the authorization-code flow with a localhost redirect. Web-app OAuth
 * clients do not support the device flow, so we use a local redirect listener.
 *
 * Token file: ~/.hermes-gateway/google-token.json  (or GOOGLE_TOKEN_FILE)
 *   { client_id, client_secret, refresh_token }
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TOKEN_FILE =
  process.env.GOOGLE_TOKEN_FILE ||
  path.join(os.homedir(), '.hermes-gateway', 'google-token.json');

const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || '454552805261-4ma4ftcosqrrq8jli89drv50oreh9nma.apps.googleusercontent.com';
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || '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';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function hasGoogleAuth() {
  try {
    const token = await readToken();
    return !!(token && token.refresh_token);
  } catch {
    return false;
  }
}

export async function readToken() {
  try {
    const raw = await readFile(TOKEN_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Return a valid access token. If the cached access token is missing/expired,
 * exchange the refresh token for a fresh one and persist it.
 */
export async function getAccessToken() {
  const token = await readToken();
  if (!token || !token.refresh_token) {
    throw new Error(
      'Google not authorized. Run: node google-consent.mjs  (one-time consent)'
    );
  }
  if (
    token.access_token &&
    token.expires_at &&
    Date.now() < token.expires_at - 60_000
  ) {
    return token.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google token refresh failed HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  token.access_token = data.access_token;
  token.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), 'utf8');
  return token.access_token;
}

/** Build an authenticated fetch wrapper for the Google APIs. */
export async function gfetch(pathOrUrl, opts = {}) {
  const access = await getAccessToken();
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `https://www.googleapis.com${pathOrUrl}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${access}`,
      'Content-Type': opts.body ? 'application/json' : 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google API HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res;
}

export { CLIENT_ID, CLIENT_SECRET, TOKEN_FILE };
