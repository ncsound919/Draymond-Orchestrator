// ============================================================================
// Local auth — users, sessions, password hashing (scrypt)
// ============================================================================
// Replaces Supabase Auth for the private self-hosted instance. A single admin
// account (or a handful of local users) lives in the `local_users` table and
// logs in with email + password. Sessions are random 256-bit tokens stored in
// `local_sessions`; the token itself is carried in a httpOnly cookie.
// ============================================================================

import crypto from 'node:crypto';
import { getDb } from './connection';

export const SESSION_COOKIE = 'draymond_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface LocalUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface LoginResult {
  token: string | null;
  user: LocalUser | null;
  error: string | null;
}

// ── password hashing (scrypt) ────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(expectedHex, 'hex');
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

// ── users ────────────────────────────────────────────────────────────────────

export function findUserByEmail(email: string): LocalUser | null {
  const row = getDb()
    .prepare('SELECT * FROM local_users WHERE email = ?')
    .get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
  return row ? toLocalUser(row) : null;
}

export function findUserById(id: string): LocalUser | null {
  const row = getDb()
    .prepare('SELECT * FROM local_users WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? toLocalUser(row) : null;
}

export function createUser(email: string, password: string, role = 'admin'): LocalUser {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO local_users (id, email, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, email.toLowerCase().trim(), hashPassword(password), role, now, now);
  return { id, email: email.toLowerCase().trim(), role, created_at: now, updated_at: now };
}

// ── sessions ─────────────────────────────────────────────────────────────────

export function createSession(userId: string): string {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO local_sessions (token, user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(token, userId, now, expiresAt);
  return token;
}

export function getUserBySessionToken(token: string | undefined | null): LocalUser | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.created_at, u.updated_at
       FROM local_sessions s
       JOIN local_users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, new Date().toISOString()) as Record<string, unknown> | undefined;
  return row ? toLocalUser(row) : null;
}

export function destroySession(token: string | undefined | null): void {
  if (!token) return;
  getDb().prepare('DELETE FROM local_sessions WHERE token = ?').run(token);
}

export function pruneExpiredSessions(): void {
  getDb()
    .prepare('DELETE FROM local_sessions WHERE expires_at <= ?')
    .run(new Date().toISOString());
}

// ── login ────────────────────────────────────────────────────────────────────

export function login(email: string, password: string): LoginResult {
  // Bootstrap the local admin account on a fresh database. Idempotent.
  ensureAdminUser();
  const user = findUserByEmail(email);
  if (!user) return { token: null, user: null, error: 'Invalid email or password' };
  const row = getDb()
    .prepare('SELECT password_hash FROM local_users WHERE id = ?')
    .get(user.id) as { password_hash: string };
  if (!verifyPassword(password, row.password_hash)) {
    return { token: null, user: null, error: 'Invalid email or password' };
  }
  pruneExpiredSessions();
  const token = createSession(user.id);
  return { token, user, error: null };
}

// ── admin bootstrap ──────────────────────────────────────────────────────────

/**
 * Ensure at least one admin exists. On a fresh database, creates the account
 * from DRAYMOND_ADMIN_EMAIL / DRAYMOND_ADMIN_PASSWORD (or a generated password
 * that is printed to the console). Returns the admin account.
 */
export function ensureAdminUser(): LocalUser {
  const existing = getDb()
    .prepare('SELECT * FROM local_users WHERE role = ? LIMIT 1')
    .get('admin') as Record<string, unknown> | undefined;
  if (existing) return toLocalUser(existing);

  const email = (process.env.DRAYMOND_ADMIN_EMAIL ?? 'admin@localhost').toLowerCase().trim();
  const password =
    process.env.DRAYMOND_ADMIN_PASSWORD ??
    crypto.randomBytes(6).toString('base64url');
  const user = createUser(email, password);

  if (!process.env.DRAYMOND_ADMIN_PASSWORD) {
    console.warn(
      `\n[Draymond] Created local admin account with a generated password.\n` +
        `  Email:    ${user.email}\n` +
        `  Password: ${password}\n` +
        `Save it now — it will not be shown again. Set DRAYMOND_ADMIN_EMAIL / ` +
        `DRAYMOND_ADMIN_PASSWORD in .env.local to control the bootstrap account.\n`
    );
  }
  return user;
}

function toLocalUser(row: Record<string, unknown>): LocalUser {
  const str = (v: unknown): string => (v == null ? '' : String(v));
  return {
    id: str(row.id),
    email: str(row.email),
    role: str(row.role),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}
