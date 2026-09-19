/* Register the audit team as canonical Draymond entities.
   Run: npx tsx scripts/register-audit-team.ts
   Idempotent. "Register, don't move" — tools stay at their physical locations.

   Surfaces updated:
     1. draymond_entities (data/draymond.db via registerEntity/registerEntities):
        - upserts the audit-team members declared in seed.ts (the-deep,
          vibe-reality, benchmark-olympics, audit-chain)
        - merges the 'audit-team' tag onto every existing member without
          clobbering its other fields
        - registers the 'audit-team' umbrella entity
     2. Reports the live roster with each member's provenance basis.

   The roster itself is declared in src/lib/draymond/audit-team.ts — this
   script only applies it to the registry. */
import { registerEntity, registerEntities, getEntity, updateEntity } from '../src/lib/draymond/registry';
import { SEED_ENTITIES } from '../src/lib/draymond/seed';
import { AUDIT_TEAM, auditTeamSlugs, auditTeamSummary } from '../src/lib/draymond/audit-team';
import { getAgentBySlug, upsertAgent } from '../src/lib/registry/agent-store';
import type { RegisteredAgent } from '../src/lib/registry/types';

const MEMBER_SLUGS = new Set(auditTeamSlugs());

/** Apply audit-team membership to the file-based agent roster (registry.json).
 *  Adds Codegang, then stamps each existing member's `team` list. Uses
 *  upsertAgent so live registry.json entries (systems, uploads) are preserved —
 *  the full seed-agents.mjs seeder is NOT run (it rewrites the whole store). */
async function ensureAgentRoster(): Promise<void> {
  const now = new Date().toISOString();
  const peers = (self: string) => auditTeamSlugs().filter((s) => s !== self);

  const existing = await getAgentBySlug('codegang');
  const codegang: RegisteredAgent = {
    id: 'codegang',
    slug: 'codegang',
    name: 'Codegang',
    codename: 'The Inspector',
    version: '1.0.0',
    tier: 'specialist',
    role: 'Deterministic Deep-Analysis Engine',
    tagline: 'Multi-scanner local analysis — security, bugs, prompt-injection, edge-cases, deps',
    bio: 'A deterministic multi-scanner suite and agent pipeline. Six scanners and six innovation engines produce 0-100 scores and findings without needing a remote repo. Serves the run-review gate locally and feeds RepoRank.',
    personality: 'analytical',
    voice: 'deterministic, evidence-first, no LLM where a rule will do',
    backstory:
      'Codegang was assembled to review code that has no GitHub URL — an on-disk workspace, a single file, a partial diff. It runs a fixed suite of scanners and returns findings plus 0-100 scores, so the review gate never has to guess.',
    avatarUrl: '/avatars/codegang.png',
    theme: { accentColor: '#4f9cf9', cardStyle: 'glass', portraitFrame: 'circle', badgeColor: '#4f9cf9' },
    specialties: ['Deep Analysis', 'Security Scanning', 'Bug Detection', 'Local Scoring', 'Multi-Agent Pipeline'],
    capabilities: [
      { id: 'analyze', label: 'Deep Analysis', description: 'Content-based analyzer over files or diffs' },
      { id: 'security', label: 'Security Scanning', description: 'Deterministic secret/injection/exposure checks' },
      { id: 'bugs', label: 'Bug Detection', description: 'Rule-based defect taxonomy' },
      { id: 'pipeline', label: 'Multi-Agent Pipeline', description: 'scout → planner → executor → validator → committer' },
    ],
    stats: [
      { label: 'Determinism', value: 96 },
      { label: 'Coverage', value: 90 },
      { label: 'Speed', value: 88 },
      { label: 'Signal', value: 89 },
    ],
    tags: ['audit-team', 'audit', 'review', 'analysis', 'scoring'],
    skills: ['coding-agent', 'sp-code-review', 'ecc-security-review'],
    runtime: { type: 'http', endpoint: 'http://localhost:3204', healthPath: '/api', timeoutMs: 120000 },
    permissions: {
      canReadFiles: true,
      canWriteFiles: false,
      canRunCommands: true,
      canAccessInternet: false,
      canAccessDatabase: false,
      canSendEmail: false,
    },
    workflows: [],
    team: peers('codegang'),
    missionRole: 'E3 - deterministic local audit for repos and agent workspaces',
    duty: 'always-on',
    memoryEnabled: true,
    persistentMemory: true,
    status: 'unknown',
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    sourceType: 'builtin',
  };
  await upsertAgent(codegang);

  let stamped = 0;
  for (const member of AUDIT_TEAM) {
    if (member.slug === 'codegang') continue;
    const a = await getAgentBySlug(member.slug);
    if (!a) continue;
    await upsertAgent({ ...a, team: peers(member.slug), updatedAt: now });
    stamped += 1;
  }
  console.log(`agent roster: codegang upserted, team stamped on ${stamped} existing member(s)`);
}

async function main(): Promise<void> {
  // 1. Upsert the members that live in the canonical seed.
  const seedMembers = SEED_ENTITIES.filter((e) => MEMBER_SLUGS.has(e.slug));
  const seedResult = await registerEntities(seedMembers);

  // 2. For every member, ensure it exists and carries the audit-team tag.
  const ensured: string[] = [];
  const missing: string[] = [];
  for (const member of AUDIT_TEAM) {
    const existing = await getEntity(member.slug);
    if (!existing) {
      // Not in seed.ts and not in the DB — register a minimal row from the
      // roster metadata so the team is complete and honest about its basis.
      await registerEntity({
        name: member.name,
        slug: member.slug,
        kind: member.kind,
        description: `${member.role} (basis: ${member.basis}). ${member.notes}`,
        tags: ['audit-team', 'audit', member.basis],
        category: 'audit',
        sector: 'community',
        invocation_method: member.invocation,
        invocation_config: member.env || member.port ? { url: member.env, port: member.port ?? undefined } : {},
        capabilities: [member.basis, 'audit'],
        download_path: member.location ?? undefined,
        is_integrated: true,
        is_active: true,
        risk_level_default: member.basis === 'deterministic' ? 'low' : 'medium',
      });
      ensured.push(member.slug);
      continue;
    }

    const tags = Array.from(new Set([...(existing.tags ?? []), 'audit-team']));
    if (!(existing.tags ?? []).includes('audit-team')) {
      await updateEntity(existing.id, { tags });
    }
    ensured.push(member.slug);
  }

  // 3. Register the umbrella entity so the team is addressable as one unit.
  await registerEntity({
    name: 'Audit Team',
    slug: 'audit-team',
    kind: 'service',
    description:
      `Canonical audit / verification team — ${AUDIT_TEAM.length} members, declared in ` +
      `src/lib/draymond/audit-team.ts (register, don't move). ` +
      `Provenance split is explicit: deterministic static analysis is separated from AI model output ` +
      `and real measurement, so AI scores are never presented as independent measurements. ` +
      `Orchestrated end-to-end by audit-chain, which refuses to seal an audit with zero included auditors. ` +
      `Members: ${auditTeamSlugs().join(', ')}.`,
    version: '1.0.0',
    tags: ['audit-team', 'audit', 'verification', 'provenance'],
    category: 'audit',
    sector: 'community',
    invocation_method: 'internal',
    invocation_config: { module_path: '@/lib/draymond/audit-team' },
    capabilities: ['audit-orchestration', 'provenance-disclosure', 'deterministic-audit', 'ai-scoring', 'measurement'],
    is_integrated: true,
    is_active: true,
    risk_level_default: 'low',
  });

  // 4. Apply the same membership to the file-based agent roster.
  await ensureAgentRoster();

  if (seedMembers.length > 0) {
    console.log(`seed entities upserted: ${seedMembers.map((e) => e.slug).join(', ')} ` +
      `(${seedResult.registered} ok${seedResult.errors.length ? `, ${seedResult.errors.length} errors` : ''})`);
    for (const err of seedResult.errors) console.error(`  ${err}`);
  }
  console.log(`members ensured: ${ensured.join(', ')}`);
  if (missing.length > 0) console.log(`members missing: ${missing.join(', ')}`);
  console.log(`umbrella: audit-team`);
  console.log(auditTeamSummary());
}

main().catch((err) => {
  console.error('AUDIT-TEAM REGISTRATION FAILED:', err);
  process.exit(1);
});
