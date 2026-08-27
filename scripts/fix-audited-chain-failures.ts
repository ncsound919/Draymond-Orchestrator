/* Repair the chain failures found in the 2026-08-25 audit:

   1. Deep Research Weekly — job fired research-brief-delivery with NO input,
      so $.input.topic resolved to "" and was stripped -> HTTP 422
      ("query: Field required") on omni-research /api/research.
      Fix: seed job_config.input with a default topic + dataset.

   2. Hemp Research & News Digest — job_config.chain_slug pointed at
      "hemp-research-news-digest" but the registered template is
      "hemp-research-news" (stale after a rename) -> "Chain template not found".
      Fix: repoint chain_slug at the real template slug.

   3. kaggle entity — invocation_config has no auth headers, so every call to
      the authed /api/ops/kaggle route returned HTTP 401 Unauthorized.
      Fix: add `Authorization: Bearer ${CRON_SECRET}`; the invoker now
      interpolates ${ENV_VAR} header values at call time so rotation is safe.

   Idempotent. Run: npx tsx scripts/fix-audited-chain-failures.ts */
import { createDraymondAdminClient } from "../src/lib/draymond/client";
import { getJob, updateJob } from "../src/lib/draymond/scheduler";
import { getEntity } from "../src/lib/draymond/registry";

async function fixDeepResearchInput(): Promise<void> {
  const job = await getJob("Deep Research Weekly");
  if (!job) {
    console.log("Deep Research Weekly: NOT FOUND");
    return;
  }
  const input = (job.job_config?.input as Record<string, unknown>) ?? {};
  if (!input.topic) {
    const next = {
      ...job.job_config,
      input: {
        topic: "AI agents, automation tooling, and indie internet business intelligence",
        dataset: "nathanlauga/nba-games",
        tags: "research",
        force: false,
      },
    };
    await updateJob(job.id, { job_config: next });
    console.log("Deep Research Weekly: added default input (topic/dataset/tags)");
  } else {
    console.log("Deep Research Weekly: input already set, skipping");
  }
}

async function fixHempChainSlug(): Promise<void> {
  const job = await getJob("Hemp Research & News Digest");
  if (!job) {
    console.log("Hemp Research & News Digest: NOT FOUND");
    return;
  }
  const slug = job.job_config?.chain_slug as string | undefined;
  if (slug !== "hemp-research-news-digest") {
    console.log(`Hemp Research & News Digest: chain_slug already "${slug}", skipping`);
    return;
  }
  await updateJob(job.id, { job_config: { ...job.job_config, chain_slug: "hemp-research-news" } });
  console.log('Hemp Research & News Digest: chain_slug -> "hemp-research-news"');
}

async function fixKaggleAuth(): Promise<void> {
  const entity = await getEntity("kaggle");
  if (!entity) {
    console.log("kaggle entity: NOT FOUND");
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = { ...(entity.invocation_config ?? {}) } as any;
  const headers = { ...(cfg.headers ?? {}) } as Record<string, string>;
  if (headers.Authorization) {
    console.log("kaggle entity: Authorization header already present, skipping");
    return;
  }
  headers.Authorization = "Bearer ${CRON_SECRET}";
  cfg.headers = headers;
  const db = createDraymondAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await db.from("draymond_entities").update({ invocation_config: cfg }).eq("id", entity.id)) as any;
  if (error) {
    console.log(`kaggle entity: ERROR ${error.message}`);
    return;
  }
  console.log("kaggle entity: added Authorization: Bearer ${CRON_SECRET} (interpolated at call time)");
}

async function main(): Promise<void> {
  await fixDeepResearchInput();
  await fixHempChainSlug();
  await fixKaggleAuth();
}

main().catch((err) => {
  console.error("FIX FAILED:", err);
  process.exit(1);
});
