import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_DIR = path.join(os.homedir(), '.hermes-gateway', 'sessions');
const MAX_SUMMARY_TURNS = 40;

function resolveDir() {
  return process.env.HERMES_MEMORY_DIR || DEFAULT_DIR;
}

function fileFor(sessionId) {
  return path.join(resolveDir(), `${sessionId}.jsonl`);
}

function normalizeSession(sessionId) {
  const s = String(sessionId || 'default').trim();
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Append one visible turn (role user|assistant, content string) to a session.
 */
export async function appendTurn(sessionId, turn) {
  const file = fileFor(normalizeSession(sessionId));
  await fs.mkdir(path.dirname(file), { recursive: true });
  const line = JSON.stringify({ role: turn.role, content: String(turn.content ?? ''), ts: Date.now() });
  await fs.appendFile(file, line + '\n', 'utf8');
}

/**
 * Read up to `maxTurns` most-recent turns + a rolling summary of earlier turns.
 * Returns { turns, summary }.
 */
export async function getContext(sessionId, opts = {}) {
  const file = fileFor(normalizeSession(sessionId));
  const maxTurns = opts.maxTurns ?? 12;
  let lines = [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    lines = raw.split('\n').filter((l) => l.trim());
  } catch {
    return { turns: [], summary: '' };
  }

  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const recent = parsed.slice(-maxTurns);
  const older = parsed.slice(0, -maxTurns);
  let summary = '';
  if (older.length >= MAX_SUMMARY_TURNS) {
    summary =
      `Earlier conversation (${older.length} turns). ` +
      older.slice(-8).map((t) => `${t.role}: ${String(t.content).slice(0, 80)}`).join(' | ');
  } else if (older.length > 0) {
    summary = older.slice(-4).map((t) => `${t.role}: ${String(t.content).slice(0, 120)}`).join('\n');
  }

  return {
    turns: recent.map((t) => ({ role: t.role, content: t.content })),
    summary,
  };
}
