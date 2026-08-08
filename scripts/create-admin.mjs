#!/usr/bin/env node
// ============================================================================
// Create or reset the local admin account.
// ============================================================================
// Usage:
//   node scripts/create-admin.mjs                # prompt for email + password
//   node scripts/create-admin.mjs admin@x.com secretpass   # inline
//   DRAYMOND_ADMIN_EMAIL=a@b.c DRAYMOND_ADMIN_PASSWORD=x node scripts/create-admin.mjs --env
//
// The admin is also bootstrapped automatically on first login — this script
// exists so you can set a known password before that happens.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dbPath = process.env.DRAYMOND_DB_PATH ?? path.join(root, 'data', 'draymond.db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(
      `[create-admin] Database not found at ${dbPath}. Start the app once (npm run dev) so the schema is created, then re-run.`
    );
    process.exit(1);
  }

  let email = process.env.DRAYMOND_ADMIN_EMAIL;
  let password = process.env.DRAYMOND_ADMIN_PASSWORD;

  const args = process.argv.slice(2);
  const envMode = args.includes('--env');
  const inline = args.filter((a) => !a.startsWith('--'));

  if (inline.length >= 2) {
    email = inline[0];
    password = inline[1];
  } else if (!envMode) {
    const rl = readline.createInterface({ input, output });
    email = (await rl.question('Admin email: ')).trim();
    password = await rl.question('Admin password: ', { hideEchoBack: true });
    rl.close();
  }

  if (!email || !password) {
    console.error('[create-admin] Email and password are required.');
    process.exit(1);
  }

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM local_users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    db.prepare('UPDATE local_users SET password_hash = ?, updated_at = ? WHERE email = ?').run(
      hashPassword(password),
      now,
      email.toLowerCase()
    );
    console.log(`[create-admin] Updated password for ${email.toLowerCase()}`);
  } else {
    db.prepare(
      `INSERT INTO local_users (id, email, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', ?, ?)`
    ).run(crypto.randomUUID(), email.toLowerCase(), hashPassword(password), now, now);
    console.log(`[create-admin] Created admin ${email.toLowerCase()}`);
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
