#!/usr/bin/env node
// ============================================================================
// One-time cleanup: remove test-fabricated state from the live registry.
// ============================================================================
// `tests/repair-team.test.ts` used fixture job ids j1–j4 (names "Evening
// Marketing Prep", "Daily Health Digest", "X") and, before test isolation,
// wrote them into the REAL .draymond/repair-team-log.json and
// learning-outcomes.json. That fake data then distilled into self-learning
// lessons and workplace recaps ("X repair (escalated)"). This script removes
// the fabricated entries. Run once; the isolation fix prevents recurrence.
//
// Usage: node scripts/cleanup-test-pollution.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(root, '.draymond');

function cleanFile(file, isOutcome) {
  const abs = path.join(DIR, file);
  if (!fs.existsSync(abs)) {
    console.log(`- ${file}: not present, nothing to clean`);
    return;
  }
  const raw = fs.readFileSync(abs, 'utf-8');
  const parsed = JSON.parse(raw);
  let before = 0;
  let after = 0;

  if (Array.isArray(parsed)) {
    before = parsed.length;
    const filtered = parsed.filter((r) => {
      // Remove rows written by the old repair-team.test.ts fixtures.
      const jobId = String(r.jobId ?? '');
      const jobName = String(r.jobName ?? '');
      const agentId = String(r.agentId ?? '');
      const summary = String(r.summary ?? '');
      const isFixtureId = /^j[1-4]$/.test(jobId);
      const isFixtureName = jobName === 'X' || (jobName === 'Daily Health Digest' && isFixtureId) || (jobName === 'Evening Marketing Prep' && isFixtureId);
      const isFixtureAgent = /^repair-team:/.test(agentId) && /^(j[1-4]|X )/.test(summary);
      const isFixtureSummary = /X repair \(escalated\)/.test(summary) && /NEWSAPI_KEY/.test(r.detail ?? '');
      return !(isFixtureId || isFixtureName || isFixtureAgent || isFixtureSummary);
    });
    after = filtered.length;
    fs.writeFileSync(abs, JSON.stringify(filtered, null, 2), 'utf-8');
  } else if (parsed && Array.isArray(parsed.lessons)) {
    before = parsed.lessons.length;
    const filtered = parsed.lessons.filter((l) => {
      const t = String(l.lesson ?? '') + ' ' + String(l.pattern ?? '') + ' ' + String(l.agentId ?? '');
      return !(/X repair \(escalated\)/.test(t) && /NEWSAPI_KEY/.test(String(l.agentId ?? '') + String(l.lesson ?? '')));
    });
    after = filtered.length;
    parsed.lessons = filtered;
    fs.writeFileSync(abs, JSON.stringify(parsed, null, 2), 'utf-8');
  } else {
    console.log(`- ${file}: unexpected shape, skipped`);
    return;
  }

  console.log(`- ${file}: removed ${before - after} test-fabricated entries (${before} → ${after})`);
}

cleanFile('repair-team-log.json', false);
cleanFile('learning-outcomes.json', true);
cleanFile('learning-lessons.json', false);

console.log('\nDone. The self-learning loop will now distill only real outcomes.');
