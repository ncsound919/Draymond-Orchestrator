#!/usr/bin/env node
/**
 * Generate agent portrait photos via the image-generation skill (z-ai-web-dev-sdk).
 *
 * Reads the registry, builds a portrait prompt from each agent's name/role/
 * personality, generates a PNG, and writes public/avatars/<slug>.png.
 *
 * Fail-closed: if the z-ai SDK (or its key) isn't available, it reports which
 * avatars still need generation instead of fabricating files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(process.cwd());
const registryPath = path.join(process.env.DRAYMOND_REGISTRY_DIR || path.join(root, '.draymond'), 'registry.json');
const avatarsDir = path.join(root, 'public', 'avatars');

function portraitPrompt(agent) {
  const theme = (agent.personality || 'analytical').toLowerCase();
  const tone =
    theme.includes('creative') || theme.includes('playful') ? 'warm, expressive portrait'
    : theme.includes('empathic') ? 'approachable, human portrait'
    : 'sharp, professional portrait';
  return `Professional studio ${tone} of "${agent.name}" (${agent.role}), confident ${theme} business AI, clean neutral background, high detail, natural light, square headshot.`;
}

async function resolveSdk() {
  for (const base of [root, path.join(root, 'agents', 'skills', 'image-generation')]) {
    try {
      return require(require.resolve('z-ai-web-dev-sdk', { paths: [base] }));
    } catch { /* try next */ }
  }
  return null;
}

async function generateOne(sdk, agent) {
  const zai = await sdk.default?.create?.() ?? await sdk.create();
  const resp = await zai.images.generations.create({
    prompt: portraitPrompt(agent),
    size: '1024x1024',
  });
  const base64 = resp?.data?.[0]?.base64;
  if (!base64) throw new Error('no base64 in response');
  return Buffer.from(base64, 'base64');
}

async function main() {
  if (!fs.existsSync(registryPath)) {
    console.log('no registry at ' + registryPath);
    return;
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  const agents = (registry.agents || []).filter((a) => a.slug);

  const sdk = await resolveSdk();
  if (!sdk) {
    console.log(`z-ai-web-dev-sdk not resolvable — generated 0 avatars.`);
    console.log('Pending (prompts ready): ' + agents.map((a) => a.slug).join(', '));
    return;
  }

  fs.mkdirSync(avatarsDir, { recursive: true });
  let generated = 0;
  let failed = 0;
  for (const agent of agents) {
    const outFile = path.join(avatarsDir, `${agent.slug}.png`);
    try {
      const buffer = await generateOne(sdk, agent);
      fs.writeFileSync(outFile, buffer);
      generated++;
      console.log(`avatar -> ${agent.slug}.png`);
    } catch (err) {
      failed++;
      console.error(`failed ${agent.slug}: ${err.message}`);
    }
  }
  console.log(`Avatars: ${generated} generated, ${failed} failed, ${agents.length} agents.`);
}

main().catch((err) => {
  console.error('avatar run failed:', err.message);
  process.exit(1);
});
