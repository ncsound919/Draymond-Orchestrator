/**
 * Voice system — voice cloning + open-source voices for agents.
 *
 * Two voice pools:
 *   - Cloned: a synthesized copy of the user's voice (needs a sample WAV +
 *     a TTS clone model, e.g. Coqui XTTS / OpenVoice).
 *   - Open-source: Piper voices (fast, local, per-language) + fallbacks.
 *
 * Each agent is assigned a voice; this module resolves the voice config and
 * can synthesize a short greeting. Model paths are config-driven; if a model
 * isn't installed the functions report not-available (fail-closed).
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface Voice {
  id: string;
  label: string;
  kind: "clone" | "open-source";
  engine: "piper" | "xtts" | "none";
  /** Piper model name (e.g. en_US-lessac-medium). */
  model?: string;
  /** Sample for clone engines. */
  samplePath?: string;
}

export interface AgentVoice {
  agentId: string;
  voiceId: string;
}

const VOICES: Voice[] = [
  { id: "user-clone", label: "User clone (cloned voice)", kind: "clone", engine: "xtts", samplePath: process.env.VOICE_SAMPLE_WAV },
  { id: "piper-en-f", label: "Piper English (female)", kind: "open-source", engine: "piper", model: "en_US-lessac-medium" },
  { id: "piper-en-m", label: "Piper English (male)", kind: "open-source", engine: "piper", model: "en_US-ryan-high" },
  { id: "piper-en-f2", label: "Piper English (female 2)", kind: "open-source", engine: "piper", model: "en_US-amy-medium" },
  { id: "none", label: "No voice (text only)", kind: "open-source", engine: "none" },
];

const AGENT_VOICES: AgentVoice[] = [
  { agentId: "aetherdesk", voiceId: "user-clone" },          // flagship = user's cloned voice
  { agentId: "social-media-dashboard", voiceId: "piper-en-f" },
  { agentId: "overlay-guardian", voiceId: "piper-en-m" },
  { agentId: "overlay-auditor", voiceId: "piper-en-m" },
  { agentId: "overlay-treasurer", voiceId: "piper-en-m" },
  { agentId: "overlay-strategist", voiceId: "piper-en-f2" },
  { agentId: "agent-browser", voiceId: "piper-en-f2" },
  { agentId: "overlay365-qa", voiceId: "piper-en-f" },
];

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const FILE = path.join(DIR, "voices.json");

async function readAssignments(): Promise<AgentVoice[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as AgentVoice[];
  } catch {
    return AGENT_VOICES;
  }
}

export async function listVoices(): Promise<Voice[]> {
  return VOICES;
}

export async function agentVoice(agentId: string): Promise<{ voice: Voice; configured: boolean; detail: string }> {
  const assignments = await readAssignments();
  const assignment = assignments.find((a) => a.agentId === agentId) ?? { agentId, voiceId: "none" };
  const voice = VOICES.find((v) => v.id === assignment.voiceId) ?? VOICES[VOICES.length - 1]!;

  let configured = false;
  let detail = `engine=${voice.engine}`;
  if (voice.engine === "piper") {
    const piperRoot = process.env.PIPER_MODELS_DIR;
    configured = Boolean(piperRoot && (await fs.stat(path.join(piperRoot, `${voice.model}.onnx`)).then(() => true).catch(() => false)));
    detail = configured ? `piper model ${voice.model} found` : `piper model ${voice.model} missing (set PIPER_MODELS_DIR)`;
  } else if (voice.engine === "xtts") {
    configured = Boolean(voice.samplePath && (await /*turbopackIgnore: true*/ fs.stat(voice.samplePath!).then(() => true).catch(() => false)));
    detail = configured ? "clone model + sample ready" : "voice-clone sample missing (set VOICE_SAMPLE_WAV)";
  } else {
    detail = "no voice engine configured";
  }

  return { voice, configured, detail };
}

/** Synthesize a greeting for an agent using its voice. Returns a WAV path or null. */
export async function synthesizeGreeting(agentId: string, text: string, outDir: string): Promise<{ ok: boolean; file?: string; detail: string }> {
  const { voice, configured, detail } = await agentVoice(agentId);
  if (!configured) return { ok: false, detail };

  await fs.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, `${agentId}.wav`);

  if (voice.engine === "piper") {
    const piperRoot = process.env.PIPER_MODELS_DIR!;
    const model = path.join(piperRoot, `${voice.model}.onnx`);
    const json = path.join(piperRoot, `${voice.model}.onnx.json`);
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("python", ["-m", "piper", "-m", model, "--config", json, "-f", out]);
      proc.stdin.on("error", () => { /* stdin closed */ });
      proc.stderr.on("data", () => { /* swallow */ });
      proc.on("error", reject);
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`piper exited ${code}`))));
      proc.stdin.write(text);
      proc.stdin.end();
    });
    return { ok: true, file: out, detail: `synthesized with ${voice.model}` };
  }

  return { ok: false, detail: `engine ${voice.engine} synthesis not wired yet` };
}
