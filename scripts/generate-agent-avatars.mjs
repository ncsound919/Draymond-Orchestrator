#!/usr/bin/env node
/**
 * Generate agent portrait photos via the Gemini API (Imagen).
 *
 * Reads the registry, builds a portrait prompt from each agent's name/role/
 * personality, generates a 1024x1024 PNG, and writes public/avatars/<slug>.png.
 *
 * Usage:
 *   node scripts/generate-agent-avatars.mjs                # all agents without a real avatar
 *   node scripts/generate-agent-avatars.mjs --slug mutly   # just one agent
 *   node scripts/generate-agent-avatars.mjs --force        # regenerate even existing avatars
 *
 * Requires GEMINI_API_KEY in the environment or .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(process.cwd());
const registryPath = path.join(
  process.env.DRAYMOND_REGISTRY_DIR || path.join(root, '.draymond'),
  'registry.json'
);
const avatarsDir = path.join(root, 'public', 'avatars');

// ── .env.local loader ────────────────────────────────────────────────────────
function loadDotEnvLocal() {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

function portraitPrompt(agent) {
  const theme = (agent.personality || 'analytical').toLowerCase();
  const tone =
    theme.includes('creative') || theme.includes('playful')
      ? 'warm, expressive portrait'
      : theme.includes('empathetic')
      ? 'approachable, human portrait'
      : 'sharp, professional portrait';
  return `Professional studio ${tone} of "${agent.name}" (${agent.role}), confident ${theme} business AI, clean neutral background, high detail, natural light, square headshot.`;
}

/**
 * Generate one 1024x1024 image via Gemini native image generation.
 * @returns {Promise<Buffer>}
 */
async function generateOne(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '1:1' },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p?.inlineData?.data);
  if (!img) {
    const text = parts.find((p) => p?.text)?.text || 'no image returned';
    throw new Error(`Gemini returned no image: ${text.slice(0, 200)}`);
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

async function main() {
  loadDotEnvLocal();

  if (!process.env.GEMINI_API_KEY) {
    console.log('[avatars] GEMINI_API_KEY not set — set it in .env.local');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const slugOnly = args.indexOf('--slug') >= 0 ? args[args.indexOf('--slug') + 1] : null;
  const force = args.includes('--force');

  if (!fs.existsSync(registryPath)) {
    console.log('no registry at ' + registryPath);
    process.exit(1);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const agents = (registry.agents || []).filter((a) => a.slug);

  const targets = slugOnly
    ? agents.filter((a) => a.slug === slugOnly)
    : agents.filter((a) => {
        if (force) return true;
        const outFile = path.join(avatarsDir, `${a.slug}.png`);
        if (!fs.existsSync(outFile)) return true;
        return fs.statSync(outFile).size <= 1024; // placeholder only
      });

  if (targets.length === 0) {
    console.log(`[avatars] nothing to generate (${slugOnly ? `no agent "${slugOnly}"` : 'all avatars present'})`);
    return;
  }

  fs.mkdirSync(avatarsDir, { recursive: true });
  let generated = 0;
  let failed = 0;
  for (const agent of targets) {
    const outFile = path.join(avatarsDir, `${agent.slug}.png`);
    try {
      const buffer = await generateOne(portraitPrompt(agent));
      fs.writeFileSync(outFile, buffer);
      generated++;
      console.log(`[avatars] ${agent.slug} -> ${(buffer.length / 1024).toFixed(0)}KB`);
    } catch (err) {
      failed++;
      console.error(`[avatars] FAIL ${agent.slug}: ${err.message}`);
    }
  }
  console.log(`[avatars] done: ${generated} generated, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
