/* One-off registration of the six Overlay365 new systems into Draymond.
   Run: npx tsx scripts/register-overlay-systems.ts
   Idempotent. Two surfaces:
     1. SQLite entity DB (data/draymond.db) via registerEntities — feeds
        OPS-CATALOG + the intelligent task router (draymond_entities table).
     2. registry.json systems[] via upsertSystem — feeds the UI roster.
   The component entities registered into SQLite are a curated subset; the
   six system umbrellas are the canonical RegistrySystem entries. */
import { registerEntities } from "../src/lib/draymond/registry";
import { SEED_ENTITIES } from "../src/lib/draymond/seed";
import { upsertSystem } from "../src/lib/registry/agent-store";
import type { RegisteredSystem } from "../src/lib/registry/types";

const SYSTEM_SLUGS = [
  "overlay-music",
  "overlay-safety",
  "overlay-finance",
  "overlay-writing",
  "overlay-science",
  "sports-science",
];

const SYSTEMS: RegisteredSystem[] = [
  {
    id: "overlay-music",
    name: "Overlay Music",
    description:
      "Overlay365 Music pillar — production, scoring, publishing, and rights for artists (sovereign-music-stud, NCSOUND, dustcrate, Movie-Scoring, TapSynth, TPC-beats).",
    type: "subprocess",
    version: "1.0.0",
    config: { type: "subprocess" },
    tags: ["music", "production", "publishing", "rights", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
  {
    id: "overlay-safety",
    name: "Overlay AI-Safety",
    description:
      "Overlay365 cross-cutting AI Safety layer — 11 security domains, aegis, sentinel, llm-safety-benchmark, GAISI, ClawSafe.",
    type: "subprocess",
    version: "1.0.0",
    config: { type: "subprocess" },
    tags: ["safety", "security", "ai", "guardrails", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
  {
    id: "overlay-finance",
    name: "Overlay Finance",
    description:
      "Overlay365 Finance pillar (Wealth expansion) — FS-Agent, IP-Builder-Platform, Overlay-Business-Solutions, Recursive-IP-Builder, The-Block, Block-Hustlers.",
    type: "subprocess",
    version: "1.0.0",
    config: { type: "subprocess" },
    tags: ["finance", "wealth", "ip", "business", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
  {
    id: "overlay-writing",
    name: "Overlay Writing",
    description:
      "Overlay365 Writing pillar — Book-Publishing-Platform, Book-Writing-Assistant, Comic-Book-Builder.",
    type: "subprocess",
    version: "1.0.0",
    config: { type: "subprocess" },
    tags: ["writing", "publishing", "books", "comics", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
  {
    id: "overlay-science",
    name: "Overlay Science",
    description:
      "Overlay365 Learn/Science research arm — Sports Science + Biotech + Biotech IDE seam + shared infra (math-x, ZeroPay, Phaselock, Supabase MCP).",
    type: "http",
    version: "1.0.0",
    config: { type: "http" },
    tags: ["science", "biotech", "research", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
  {
    id: "sports-science",
    name: "sports_science",
    description:
      "Overlay365 Sport pillar — the sports analytics engine Draymond already executes (codex_metrics, injury_risk, archetypes, run_coach, run_metrics, skill_bridge).",
    type: "subprocess",
    version: "0.2.0",
    config: { type: "subprocess" },
    tags: ["sports", "analytics", "biomechanics", "overlay365"],
    status: "unknown",
    installedAt: new Date().toISOString(),
    sourceType: "folder",
  },
];

async function main(): Promise<void> {
  const entityInputs = SEED_ENTITIES.filter((e) =>
    SYSTEM_SLUGS.includes(e.slug)
  );
  const entityResult = await registerEntities(entityInputs);

  for (const sys of SYSTEMS) {
    await upsertSystem(sys);
  }

  console.log(
    JSON.stringify(
      {
        entities: {
          registered: entityResult.registered,
          errors: entityResult.errors,
        },
        systems: { upserted: SYSTEMS.length },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("REGISTRATION FAILED:", err);
  process.exit(1);
});
