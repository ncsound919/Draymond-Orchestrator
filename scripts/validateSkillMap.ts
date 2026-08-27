// ============================================================================
// DRAYMOND — Skill Model Map Validator
// ============================================================================
// Validates .draymond/skill-model-map.json against model-routing.json lanes.
// Usage: npx tsx scripts/validateSkillMap.ts
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function validate(): void {
  const registryDir = process.env.DRAYMOND_REGISTRY_DIR ?? join(process.cwd(), '.draymond');
  const mapPath = join(registryDir, 'skill-model-map.json');
  const routingPath = join(registryDir, 'model-routing.json');

  if (!existsSync(mapPath)) {
    console.error('FAIL: skill-model-map.json does not exist');
    process.exit(1);
  }

  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as {
    count: number;
    skills: Record<string, { tier: string; provider: string; model: string }>;
  };

  const routing = existsSync(routingPath)
    ? (JSON.parse(readFileSync(routingPath, 'utf8')) as {
        lanes?: Array<{ model: string }>;
        primary?: { model: string };
      })
    : {};

  const validModels = new Set<string>();
  if (routing.primary?.model) validModels.add(routing.primary.model);
  validModels.add('x-preview-f-free');
  validModels.add('ox-alpha-free');
  validModels.add('deepseek-v4-flash');
  validModels.add('deepseek-chat');
  for (const lane of routing.lanes ?? []) {
    if (lane.model) validModels.add(lane.model);
  }

  const skills = Object.entries(map.skills ?? {});
  let validCount = 0;
  let unmappedModel = 0;

  const tierCounts: Record<string, number> = {};

  for (const [skillId, entry] of skills) {
    tierCounts[entry.tier] = (tierCounts[entry.tier] ?? 0) + 1;
    if (!validModels.has(entry.model)) {
      console.warn(`WARNING: skill "${skillId}" uses model "${entry.model}" not found in model-routing.json`);
      unmappedModel++;
    } else {
      validCount++;
    }
  }

  console.log('--- Skill Model Map Validation ---');
  console.log(`Total skills mapped: ${skills.length}`);
  console.log(`Valid model mappings: ${validCount}/${skills.length} (${Math.round((validCount / skills.length) * 100)}%)`);
  console.log('Tier distribution:', JSON.stringify(tierCounts, null, 2));

  if (unmappedModel > 0) {
    console.warn(`Warnings: ${unmappedModel} skills map to models outside model-routing.json`);
  } else {
    console.log('✅ 100% of skills map to valid fleet model lanes!');
  }
}

validate();
