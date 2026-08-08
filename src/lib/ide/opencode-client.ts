// ============================================================================
// DRAYMOND AGENT IDE — opencode codegen engine (headless serve HTTP API)
// ============================================================================
// opencode is the codegen primary. It runs as a headless server
// (`opencode serve --port 4096`) and codegen steps drive its HTTP API:
//   POST /session { directory, model }        → create a session
//   POST /session/{id}/message { parts:[…] }  → send the prompt, get the reply
//   DELETE /session/{id}                      → tidy up
// This is TTY-free (the `opencode run` CLI hangs without a console on Windows).
// The workspace is git-initialized so opencode treats it as its own project
// root and writes code there. Auth is HTTP Basic (opencode:<password>).
// ============================================================================

import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SERVE_PORT = Number(process.env.OPENCODE_SERVE_PORT ?? 4096);
const DEFAULT_MODEL = process.env.OPENCODE_MODEL ?? 'opencode/deepseek-v4-flash';
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? 'ocpass';
const SERVE_URL = `http://127.0.0.1:${SERVE_PORT}`;

let serverEnsured = false;

function authHeader(): string {
  return `Basic ${Buffer.from(`opencode:${SERVER_PASSWORD}`).toString('base64')}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(1500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => { sock.destroy(); resolve(false); });
  });
}

/** Ensure the headless opencode server is running (once per process). */
async function ensureServer(): Promise<void> {
  if (!(await isListening(SERVE_PORT)) && !serverEnsured) {
    serverEnsured = true;
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', `opencode serve --port ${SERVE_PORT}`], {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, OPENCODE_SERVER_PASSWORD: SERVER_PASSWORD },
          })
        : spawn('opencode', ['serve', '--port', String(SERVE_PORT)], {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, OPENCODE_SERVER_PASSWORD: SERVER_PASSWORD },
          });
    child.unref();
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      if (await isListening(SERVE_PORT)) break;
    }
  }
}

/** Make the workspace a git project so opencode writes code there (not the server root). */
function ensureGitProject(workspace: string): void {
  try {
    if (!fs.existsSync(path.join(workspace, '.git'))) {
      execFileSync('git', ['init', '-q'], { cwd: workspace, stdio: 'ignore' });
    }
  } catch {
    // non-git workspace is fine — opencode falls back to the workspace dir
  }
}

async function requestJson<T>(method: string, p: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`${SERVE_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`opencode ${method} ${p} failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface OpencodeSession {
  id: string;
  directory?: string;
}

interface OpencodeMessage { parts?: Array<{ type?: string; text?: string }>; info?: { modelID?: string; providerID?: string } }

async function createSession(workspace: string, model: string): Promise<OpencodeSession> {
  return requestJson<OpencodeSession>('POST', '/session', { directory: workspace, model });
}

async function sendMessage(sessionId: string, prompt: string, timeoutMs: number): Promise<OpencodeMessage> {
  return requestJson<OpencodeMessage>('POST', `/session/${sessionId}/message`, { parts: [{ type: 'text', text: prompt }] }, timeoutMs);
}

async function deleteSession(sessionId: string): Promise<void> {
  await requestJson('DELETE', `/session/${sessionId}`, undefined, 10_000).catch(() => {});
}

export interface OpencodeResult {
  success: boolean;
  content: string;
  error?: string;
  duration_ms: number;
  model?: string;
}

/** Extract fenced code blocks from an assistant reply. Falls back to the raw text. */
export function extractCodeBlocks(content: string, language = 'ts'): string[] {
  const re = new RegExp('```(?:' + language + '|typescript|ts|javascript|js)?\\s*\\n?([\\s\\S]*?)```', 'gi');
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1]?.trim()) blocks.push(m[1].trim());
  }
  return blocks.length > 0 ? blocks : (content.trim() ? [content.trim()] : []);
}

/**
 * Run opencode headless to produce code for a prompt in a workspace.
 * Never throws.
 */
export async function runOpencodeCodegen(input: {
  prompt: string;
  workspace: string;
  model?: string;
  timeoutMs?: number;
}): Promise<OpencodeResult> {
  const started = Date.now();
  const model = input.model ?? DEFAULT_MODEL;
  const timeout = input.timeoutMs ?? 180_000;
  try {
    await ensureServer();
    ensureGitProject(input.workspace);

    const session = await createSession(input.workspace, model);
    try {
      const msg = await sendMessage(session.id, input.prompt, timeout);
      const content = (msg.parts ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n')
        .trim();

      if (!content) {
        return { success: false, content: '', error: 'opencode returned no text', duration_ms: Date.now() - started };
      }
      return {
        success: true,
        content,
        duration_ms: Date.now() - started,
        model: msg.info?.modelID ?? model,
      };
    } finally {
      await deleteSession(session.id).catch(() => {});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, content: '', error: message.slice(0, 500), duration_ms: Date.now() - started };
  }
}
