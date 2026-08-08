// ============================================================================
// DRAYMOND AGENT IDE — session persistence store
// ============================================================================
// Sessions persist as JSON files under .draymond/ide-sessions/. Same directory
// convention as the registry and repair-team log so all Draymond state lives
// in one place and is easy to inspect.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IdeSession } from './types';

/** Resolved lazily so tests (fresh temp dirs per case) and prod both work. */
function sessionsDir(): string {
  const base = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), '.draymond');
  return path.join(base, 'ide-sessions');
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(sessionsDir(), { recursive: true });
}

function fileFor(id: string): string {
  return path.join(sessionsDir(), `${id}.json`);
}

export async function saveSession(session: IdeSession): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(session.id), JSON.stringify(session, null, 2), 'utf-8');
}

export async function loadSession(id: string): Promise<IdeSession | null> {
  try {
    const raw = await fs.readFile(fileFor(id), 'utf-8');
    const parsed = JSON.parse(raw) as IdeSession;
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

export async function listSessions(limit = 50): Promise<IdeSession[]> {
  try {
    const files = await fs.readdir(sessionsDir());
    const sessions: IdeSession[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const session = await loadSession(file.replace(/\.json$/, ''));
      if (session) sessions.push(session);
    }
    sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return sessions.slice(0, limit);
  } catch {
    return [];
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(fileFor(id));
    return true;
  } catch {
    return false;
  }
}
