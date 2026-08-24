#!/usr/bin/env node
/**
 * One-time Google Workspace consent.
 *
 * Starts a local redirect listener on :9010, opens Google's consent page in
 * the default browser, captures the returned authorization code, exchanges it
 * for a refresh token, and persists it to ~/.hermes-gateway/google-token.json.
 *
 * Usage: node google-consent.mjs
 * Scopes: Gmail (send/search), Calendar (events), Drive (list/upload/search).
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CLIENT_ID, CLIENT_SECRET, TOKEN_FILE } from './google-auth.js';

const REDIRECT = 'http://localhost:9010/callback';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const authUrl = [
  'https://accounts.google.com/o/oauth2/v2/auth',
  `?client_id=${encodeURIComponent(CLIENT_ID)}`,
  `&redirect_uri=${encodeURIComponent(REDIRECT)}`,
  '&response_type=code',
  `&scope=${encodeURIComponent(SCOPES.join(' '))}`,
  '&access_type=offline',
  '&prompt=consent',
].join('');

async function exchangeCode(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token exchange failed HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('not found');
    return;
  }
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      `<h3>Authorization failed: ${err}</h3><p>Close this tab.</p>`
    );
    console.error('Authorization error:', err);
    server.close();
    process.exit(1);
    return;
  }
  if (!code) {
    res.writeHead(400).end('missing code');
    return;
  }
  try {
    const data = await exchangeCode(code);
    await mkdir(path.dirname(TOKEN_FILE), { recursive: true });
    await writeFile(
      TOKEN_FILE,
      JSON.stringify(
        { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: data.refresh_token },
        null,
        2
      ),
      'utf8'
    );
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      '<h3>Authorized! You can close this tab.</h3>'
    );
    console.log('Saved refresh token to', TOKEN_FILE);
    server.close(() => process.exit(0));
  } catch (e) {
    res.writeHead(500).end('token exchange failed');
    console.error(e.message);
    server.close();
    process.exit(1);
  }
});

server.listen(9010, '127.0.0.1', () => {
  console.log('Listening on http://localhost:9010/callback for the OAuth redirect…');
  console.log('Opening consent page…');
  const open =
    process.platform === 'win32'
      ? `start "" "${authUrl}"`
      : process.platform === 'darwin'
        ? `open "${authUrl}"`
        : `xdg-open "${authUrl}"`;
  exec(open);
});
