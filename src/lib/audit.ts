import fs from 'fs/promises';
import path from 'path';

export interface AuditEntry {
  timestamp?: string;
  event: string;
  agent?: string;
  session_id?: string;
  goal?: string;
  task_count?: number;
  results_count?: number;
  failed_count?: number;
  mode?: string;
  error?: string;
  [key: string]: unknown;
}

/** Prevent path traversal: AUDIT_LOG_PATH must be inside cwd or HOME */
function safeAuditPath(): string {
  const raw = process.env.AUDIT_LOG_PATH
    ?? path.join(process.cwd(), '.audit', 'audit.jsonl');
  const resolved = path.resolve(raw);
  const allowed = [
    path.resolve(process.cwd()),
    path.resolve(process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()),
  ];
  if (!allowed.some((base) => resolved.startsWith(base + path.sep) || resolved === base)) {
    console.warn('[audit] AUDIT_LOG_PATH outside allowed dirs — using default');
    return path.join(process.cwd(), '.audit', 'audit.jsonl');
  }
  return resolved;
}

const AUDIT_LOG_PATH = safeAuditPath();

/**
 * Write-mutex: chains every write onto the previous one so concurrent calls
 * never interleave lines in the JSONL file.
 */
let _writeLock: Promise<void> = Promise.resolve();

async function ensureAuditDir(): Promise<void> {
  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
}

export async function appendAuditLog(entry: Partial<AuditEntry>): Promise<void> {
  // Chain onto the existing lock — never reject the chain itself
  _writeLock = _writeLock.then(async () => {
    await ensureAuditDir();
    const line =
      JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n';
    await fs.appendFile(AUDIT_LOG_PATH, line, 'utf-8');
  }).catch((err) => {
    // Log to stderr so failures are visible but never crash the app
    console.error('[audit] write failed:', err instanceof Error ? err.message : err);
  });
  await _writeLock;
}

export async function readAuditLog(): Promise<AuditEntry[]> {
  try {
    await ensureAuditDir();
    const content = await fs.readFile(AUDIT_LOG_PATH, 'utf-8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as AuditEntry; }
        catch { return null; }
      })
      .filter((e): e is AuditEntry => e !== null);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function clearAuditLog(): Promise<void> {
  await ensureAuditDir();
  await fs.writeFile(AUDIT_LOG_PATH, '', 'utf-8');
}
