// ============================================================================
// DRAYMOND — Skill Model Map Generator
// ============================================================================
// Scans mounted skill directories, categorizes skills into tiers, and outputs
// .draymond/skill-model-map.json.
// ============================================================================

import { readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillMapFile {
  version: number;
  generatedAt: string;
  count: number;
  tierDefaults: Record<string, { provider: string; model: string }>;
  skills: Record<string, { tier: string; provider: string; model: string }>;
}

const TIER_DEFAULTS: Record<string, { provider: string; model: string }> = {
  fast:   { provider: 'ollama',   model: 'qwen3:0.6b' },
  code:   { provider: 'ox-alpha', model: 'x-preview-f-free' },
  vision: { provider: 'ollama',   model: 'qwen3.5:4b' },
  biomed: { provider: 'ollama',   model: 'medgemma:4b' },
  ocr:    { provider: 'ollama',   model: 'deepseek-ocr:3b' },
  chem:   { provider: 'ollama',   model: 'txgemma-2b' },
};

function categorizeSkill(skillId: string): string {
  const s = skillId.toLowerCase();
  if (/vision|image|screenshot|ui-test|render-check|visual/.test(s)) return 'vision';
  if (/biomed|oncology|cancer|decon|clinical|paper|drug|medical|bio/.test(s)) return 'biomed';
  if (/ocr|pdf-extract|scan-paper|document-ocr/.test(s)) return 'ocr';
  if (/chem|smiles|admet|tdc|property-predict/.test(s)) return 'chem';
  if (/fast|classify|tag|quick|short|triage|hiccup|polish/.test(s)) return 'fast';
  return 'code'; // default tier
}

export function generateSkillMap(): SkillMapFile {
  const root = process.env.UPLIFT_ROOT ?? 'C:\\Users\\User\\Downloads\\Uplift';
  const skillDirs = [
    join(root, 'Draymond-Orchestrator', 'agents', 'skills'),
    join(root, 'Draymond-Orchestrator', 'agents', 'skills', 'skills'),
    join(root, 'Draymond-Orchestrator', 'agents', 'everything-claude-code-main', 'skills'),
    join(root, 'Deepseek Harness', 'dsh-skills'),
  ];

  const skillIds = new Set<string>();

  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          skillIds.add(entry);
        } else if (entry.endsWith('.md') && entry !== 'README.md') {
          skillIds.add(entry.replace(/\.md$/, ''));
        }
      }
    } catch {
      // skip unreadable
    }
  }

  const skills: Record<string, { tier: string; provider: string; model: string }> = {};

  for (const skillId of skillIds) {
    const tier = categorizeSkill(skillId);
    const def = TIER_DEFAULTS[tier] ?? TIER_DEFAULTS.code;
    skills[skillId] = { tier, provider: def.provider, model: def.model };
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: skillIds.size,
    tierDefaults: TIER_DEFAULTS,
    skills,
  };
}

const outDir = join(process.cwd(), '.draymond');
const outPath = join(outDir, 'skill-model-map.json');
const mapData = generateSkillMap();
writeFileSync(outPath, JSON.stringify(mapData, null, 2), 'utf8');
console.log(`Generated skill map with ${mapData.count} skills at ${outPath}`);
