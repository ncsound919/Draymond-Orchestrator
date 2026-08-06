/**
 * Music rights registration for Draymond.
 *
 * Wraps the AgentBrowser music-rights mini-services (ASCAP extract / HFA upload /
 * MLC extract). A validated catalog is staged to .draymond/music-registrations.json
 * and, when credentials are configured, handed to the matching Playwright script.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export type MusicOrg = "ascap" | "hfa" | "mlc";

export interface SongEntry {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  iswc?: string;
  duration_seconds?: number;
  writers?: { name: string; ipi?: string }[];
  publisher?: string;
  publisher_ipi?: string;
  publisher_p_number?: string;
  split_pct?: number;
  genre?: string;
}

export interface RegisterMusicInput {
  org: MusicOrg;
  songs: SongEntry[];
  email?: string;
  password?: string;
  publisher_name?: string;
  publisher_ipi?: string;
  publisher_p_number?: string;
}

export interface RegistrationRecord {
  id: string;
  org: MusicOrg;
  createdAt: string;
  status: "staged" | "submitted" | "failed";
  songCount: number;
  catalog: SongEntry[];
  result?: string;
  error?: string;
}

const REGISTRY_DIR = process.env.DRAYMOND_REGISTRY_DIR
  ?? path.join(process.cwd(), ".draymond");
const REGISTRATIONS_FILE = path.join(REGISTRY_DIR, "music-registrations.json");

const SCRIPTS: Record<MusicOrg, string> = {
  ascap: "ascap-extract.ts",
  hfa: "hfa-upload.ts",
  mlc: "mlc-extract.ts",
};

function baseDir(): string {
  return process.env.MUSIC_RIGHTS_DIR
    ?? path.join(process.cwd(), "agents", "AgentBrowser-main", "mini-services", "music-rights");
}

export function validateCatalog(songs: unknown[]): { valid: boolean; error?: string } {
  if (!Array.isArray(songs) || songs.length === 0) {
    return { valid: false, error: "songs must be a non-empty array" };
  }
  for (const s of songs) {
    if (typeof s !== "object" || s === null) return { valid: false, error: "song entries must be objects" };
    const song = s as Partial<SongEntry>;
    if (typeof song.title !== "string" || !song.title.trim()) return { valid: false, error: "each song requires a title" };
    if (typeof song.artist !== "string" || !song.artist.trim()) return { valid: false, error: "each song requires an artist" };
  }
  return { valid: true };
}

async function readRecords(): Promise<RegistrationRecord[]> {
  try {
    const raw = await fs.readFile(REGISTRATIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: RegistrationRecord[]): Promise<void> {
  await fs.mkdir(REGISTRY_DIR, { recursive: true });
  await fs.writeFile(REGISTRATIONS_FILE, JSON.stringify(records, null, 2), "utf-8");
}

/** Invoke the music-rights Playwright script with the JSON input on stdin. */
function invokeScript(scriptPath: string, input: unknown): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = execFile(
      process.env.MUSIC_RIGHTS_RUNTIME || "npx",
      ["tsx", scriptPath],
      { cwd: baseDir(), timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, output: (stderr || stdout || error.message).slice(0, 2000) });
        } else {
          resolve({ ok: true, output: stdout.slice(0, 4000) });
        }
      },
    );
    child.stdin?.end(JSON.stringify(input));
  });
}

export async function registerMusic(input: RegisterMusicInput): Promise<RegistrationRecord> {
  const check = validateCatalog(input.songs);
  if (!check.valid) throw new Error(check.error || "Invalid catalog");

  const records = await readRecords();
  const record: RegistrationRecord = {
    id: `mr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    org: input.org,
    createdAt: new Date().toISOString(),
    status: "staged",
    songCount: input.songs.length,
    catalog: input.songs,
  };

  const script = path.join(baseDir(), SCRIPTS[input.org]);
  const hasScript = await fs.stat(script).then(() => true).catch(() => false);
  const hasCreds = Boolean(input.email && input.password);

  if (hasScript && hasCreds) {
    const scriptInput = {
      email: input.email,
      password: input.password,
      publisherName: input.publisher_name,
      publisherIpi: input.publisher_ipi,
      publisherPNumber: input.publisher_p_number,
      catalog: input.songs,
    };
    const { ok, output } = await invokeScript(script, scriptInput);
    record.status = ok ? "submitted" : "failed";
    if (ok) record.result = output;
    else record.error = output;
  } else {
    record.status = "staged";
    record.error = hasScript
      ? "Staged — music-rights credentials (email/password) are required to submit."
      : "Staged — music-rights script not found; set MUSIC_RIGHTS_DIR to AgentBrowser mini-services.";
  }

  records.unshift(record);
  await writeRecords(records.slice(0, 500));
  return record;
}

export async function listRegistrations(limit = 50): Promise<RegistrationRecord[]> {
  const records = await readRecords();
  return records.slice(0, limit);
}

const OTHER_ORGS: Record<MusicOrg, MusicOrg[]> = {
  ascap: ["hfa", "mlc"],
  hfa: ["ascap", "mlc"],
  mlc: ["ascap", "hfa"],
};

/**
 * Cross-platform registration flow: after the user registers a song on ONE
 * platform, they report it here and Draymond produces the registration payloads
 * (the "files") for the remaining platforms so each can be submitted next.
 */
export async function generateCrossPlatformFiles(
  completedOrg: MusicOrg,
  songs: SongEntry[],
): Promise<{
  completed: MusicOrg;
  songCount: number;
  pending: {
    org: MusicOrg;
    script: string;
    status: "ready_to_submit";
    payload: Record<string, unknown>;
  }[];
}> {
  const check = validateCatalog(songs);
  if (!check.valid) throw new Error(check.error || "Invalid catalog");

  const scriptDir = baseDir();
  const pending = OTHER_ORGS[completedOrg].map((org) => ({
    org,
    script: path.join(scriptDir, SCRIPTS[org]),
    status: "ready_to_submit" as const,
    payload: {
      org,
      catalog: songs.map((s) => ({
        title: s.title,
        artist: s.artist,
        album: s.album,
        isrc: s.isrc,
        iswc: s.iswc,
        duration_seconds: s.duration_seconds,
        writers: s.writers,
        publisher: s.publisher,
        publisher_ipi: s.publisher_ipi,
        publisher_p_number: s.publisher_p_number,
        split_pct: s.split_pct,
        genre: s.genre,
      })),
    },
  }));

  return { completed: completedOrg, songCount: songs.length, pending };
}
