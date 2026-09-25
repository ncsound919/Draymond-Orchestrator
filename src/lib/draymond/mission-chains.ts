/**
 * Mission chains — revenue delivery chain template definitions + idempotent
 * seeding. Reuses the chains engine (createChain/addSteps) and the
 * requireEntityBySlug pattern from chains-seed.ts.
 */

import { createChain, addSteps, getChain } from "./chains";
import type { DraymondChain } from "./types";

export interface MissionStepDef {
  name: string;
  entitySlug: string;
  action: string;
  input_mapping: Record<string, unknown>;
  output_key: string;
  step_order: number;
  parallel_group?: string;
  /** Step names this step depends on (resolved to ids after creation). */
  depends_on: string[];
}

export interface MissionChainDef {
  slug: string;
  name: string;
  description: string;
  input: Record<string, unknown>;
  steps: MissionStepDef[];
}

export const MISSION_CHAIN_DEFS: MissionChainDef[] = [
  {
    slug: "maas-monthly-cycle",
    name: "MaaS Monthly Cycle",
    description: "Marketing-as-a-Service monthly deliverable: research trends, draft content + assets, QA gate, compile client package.",
    input: { niche: "local business", brand_voice: "professional", image_style: "modern" },
    steps: [
      // multi-harvest requires `query` (400s otherwise) — the chain input is `niche`.
      { name: "Research Trends", entitySlug: "omni-research", action: "trending_topics", input_mapping: { query: "$.input.niche" }, output_key: "trending", step_order: 1, depends_on: [] },
      { name: "Draft Content", entitySlug: "overlay-marketing-actions", action: "generate_text", input_mapping: { action: "generate_text", topic: "$.input.niche", template: "brief" }, output_key: "content", step_order: 2, depends_on: ["Research Trends"] },
      { name: "Generate Assets", entitySlug: "overlay-marketing-actions", action: "generate_image", input_mapping: { action: "generate_image", prompt: "$.steps.content.output.content" }, output_key: "images", step_order: 2, parallel_group: "content_gen", depends_on: ["Research Trends"] },
      { name: "Format QA", entitySlug: "mutly", action: "analyze", input_mapping: { content: "$.steps.content.output", images: "$.steps.images.output" }, output_key: "qa", step_order: 3, depends_on: ["Draft Content", "Generate Assets"] },
      { name: "Compile Client Package", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_maas_package", content: "$.steps.content.output", images: "$.steps.images.output", qa: "$.steps.qa.output" }, output_key: "package", step_order: 4, depends_on: ["Format QA"] },
    ],
  },
  {
    slug: "audit-delivery",
    name: "Audit Delivery",
    description: "Codebase audit deliverable: grade repo, deep scan, QA gate, compile audit report.",
    input: { repoUrl: "" },
    steps: [
      { name: "Grade Repo", entitySlug: "grader", action: "grade", input_mapping: { repoUrl: "$.input.repoUrl" }, output_key: "grade", step_order: 1, depends_on: [] },
      { name: "Deep Scan", entitySlug: "reporank", action: "scan", input_mapping: { repoUrl: "$.input.repoUrl" }, output_key: "scan", step_order: 1, parallel_group: "audit_scan", depends_on: [] },
      { name: "QA Gate", entitySlug: "mutly", action: "analyze", input_mapping: { repoUrl: "$.input.repoUrl", grade: "$.steps.grade.output", scan: "$.steps.scan.output" }, output_key: "qa", step_order: 2, depends_on: ["Grade Repo", "Deep Scan"] },
      { name: "Compile Audit Report", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_audit_report", repoUrl: "$.input.repoUrl", grade: "$.steps.grade.output", scan: "$.steps.scan.output", qa: "$.steps.qa.output" }, output_key: "report", step_order: 3, depends_on: ["QA Gate"] },
    ],
  },
  {
    slug: "research-brief-delivery",
    name: "Research Brief Delivery",
    description: "Research brief deliverable: deep research + data feed, then synthesize a grounded brief.",
    input: { topic: "", dataset: "nathanlauga/nba-games", tags: "research", force: false },
    steps: [
      // deep-deterministic-research requires both `query` and `domain` (400s otherwise).
      { name: "Deep Research", entitySlug: "omni-research", action: "research_news", input_mapping: { query: "$.input.topic", domain: "research" }, output_key: "research", step_order: 1, depends_on: [] },
      { name: "Data Feed", entitySlug: "kaggle", action: "research_feed", input_mapping: { dataset: "$.input.dataset", tags: "$.input.tags", force: "$.input.force" }, output_key: "feed", step_order: 1, parallel_group: "research_gather", depends_on: [] },
      { name: "Quality Check", entitySlug: "mutly", action: "analyze", input_mapping: { research: "$.steps.research.output", feed: "$.steps.feed.output" }, output_key: "qa", step_order: 2, depends_on: ["Deep Research", "Data Feed"] },
      { name: "Synthesize Brief", entitySlug: "uplift-agent", action: "batch", input_mapping: { task: "compile_research_brief", topic: "$.input.topic", research: "$.steps.research.output", feed: "$.steps.feed.output", qa: "$.steps.qa.output" }, output_key: "brief", step_order: 3, depends_on: ["Quality Check"] },
    ],
  },
];

async function requireEntityBySlug(slug: string): Promise<string> {
  const { getEntity } = await import("./registry");
  const entity = await getEntity(slug);
  if (!entity) throw new Error(`[Mission Chains] Entity "${slug}" not in registry`);
  return entity.id;
}

export interface MissionChainSeedResult {
  seeded: Array<{ name: string; slug: string; id: string }>;
  errors: Array<{ name: string; error: string }>;
}

/**
 * Seed the three mission chain templates (idempotent — skips existing slugs).
 * Returns ids of chains that already exist or were newly created, plus a
 * per-chain error report so one failure does not abort the rest.
 */
export async function seedMissionChains(): Promise<MissionChainSeedResult> {
  const seeded: MissionChainSeedResult["seeded"] = [];
  const errors: MissionChainSeedResult["errors"] = [];

  for (const def of MISSION_CHAIN_DEFS) {
    try {
      const existing = await getChain(def.slug);
      if (existing) {
        seeded.push({ name: def.name, slug: def.slug, id: existing.id });
        continue;
      }

      const entityIds: Record<string, string> = {};
      for (const step of def.steps) {
        if (!entityIds[step.entitySlug]) entityIds[step.entitySlug] = await requireEntityBySlug(step.entitySlug);
      }

      const chain: DraymondChain = await createChain({
        name: def.name,
        slug: def.slug,
        description: def.description,
        version: "1.0.0",
        is_template: true,
        status: "draft",
        trigger_type: "manual",
        input_data: def.input,
        context: {},
        max_retries: 2,
      });

      const created = await addSteps(
        def.steps.map((s) => ({
          chain_id: chain.id,
          step_order: s.step_order,
          name: s.name,
          entity_id: entityIds[s.entitySlug],
          action: s.action,
          input_mapping: s.input_mapping,
          output_key: s.output_key,
          depends_on_steps: [], // remapped below
          parallel_group: s.parallel_group,
          risk_level: s.name.includes("QA") ? "medium" : "low",
          max_retries: 2,
        }))
      );

      const byName = new Map(created.map((st) => [st.name, st]));
      const depPatches: Array<{ id: string; depends_on_steps: string[] }> = [];
      for (let i = 0; i < def.steps.length; i++) {
        const s = def.steps[i]!;
        const target = byName.get(s.name);
        if (!target) continue;
        const deps = s.depends_on.map((d) => byName.get(d)?.id).filter((x): x is string => Boolean(x));
        depPatches.push({ id: target.id, depends_on_steps: deps });
      }

      const { createDraymondClient } = await import("./client");
      const supabase = await createDraymondClient();
      for (const patch of depPatches) {
        const { error } = await supabase.from("draymond_chain_steps").update({ depends_on_steps: patch.depends_on_steps }).eq("id", patch.id);
        if (error) console.error(`[Mission Chains] dep patch failed for ${patch.id}: ${error.message}`);
      }
      await supabase.from("draymond_chains").update({ total_steps: created.length }).eq("id", chain.id);

      seeded.push({ name: def.name, slug: def.slug, id: chain.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Mission Chains] Failed to seed "${def.name}": ${message}`);
      errors.push({ name: def.name, error: message });
    }
  }

  return { seeded, errors };
}
