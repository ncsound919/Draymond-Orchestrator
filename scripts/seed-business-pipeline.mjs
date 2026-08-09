#!/usr/bin/env node
// ============================================================================
// Seed the business pipeline with the first REAL Aetherdesk opportunities.
// ============================================================================
// Mission E2 (B2B services) — AI call-center/virtual-receptionist for SMBs.
// SAAS.md targets $100–300/site/mo. These are pipeline records (lead/proposal)
// matching the product tiers wired in Aetherdesk's Stripe config — they are
// NOT revenue and are never marked "won" here. The Treasurer counts settled
// cash only.
//
// Usage:
//   node scripts/seed-business-pipeline.mjs          # adds if not already present
//   node scripts/seed-business-pipeline.mjs --reset  # clear + reseed
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(root, '.draymond');
const FILE = path.join(DIR, 'business-pipeline.json');

function readOpportunities() {
  try {
    const raw = fs.readFileSync(FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
  } catch {
    return [];
  }
}

function writeOpportunities(ops) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ opportunities: ops, updatedAt: new Date().toISOString() }, null, 2), 'utf-8');
}

// Real Aetherdesk B2B pipeline candidates (pricing per SAAS.md / Stripe tiers).
const SEED_OPPORTUNITIES = [
  {
    name: 'Aetherdesk — Starter SMB onboarding (pilot)',
    engine: 'E2-b2b',
    stage: 'lead',
    monthlyValue: 100,
    owner: 'aetherdesk',
    nextAction: 'Onboard first SMB pilot; confirm call volume + consent flow',
  },
  {
    name: 'Aetherdesk — Pro (multi-line) prospect',
    engine: 'E2-b2b',
    stage: 'lead',
    monthlyValue: 200,
    owner: 'aetherdesk',
    nextAction: 'Propose Pro tier; demo inbound routing + retention/consent compliance',
  },
  {
    name: 'Marketing-as-a-Service retainer (Observer)',
    engine: 'E2-b2b',
    stage: 'lead',
    monthlyValue: 800,
    owner: 'overlay-marketing',
    nextAction: 'Build content calendar for first local business; confirm brand-voice corpus',
  },
];

function main() {
  const reset = process.argv.includes('--reset');
  let ops = reset ? [] : readOpportunities();
  const existingNames = new Set(ops.map((o) => o.name));
  let added = 0;
  const now = new Date().toISOString();
  for (const seed of SEED_OPPORTUNITIES) {
    if (existingNames.has(seed.name)) continue;
    ops.push({ id: `opp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, createdAt: now, updatedAt: now, ...seed });
    added += 1;
  }
  writeOpportunities(ops);
  const active = ops.filter((o) => o.stage !== 'lost').reduce((s, o) => s + (o.stage === 'won' ? 0 : o.monthlyValue), 0);
  const won = ops.filter((o) => o.stage === 'won').reduce((s, o) => s + o.monthlyValue, 0);
  console.log(`Seeded ${added} opportunity(ies). Total pipeline: ${ops.length} (${ops.filter((o) => o.stage !== 'lost').length} active).`);
  console.log(`Active pipeline value: $${active}/mo · Won: $${won}/mo (won = settled revenue only, never seeded).`);
  console.log(`File: ${FILE}`);
}

main();
