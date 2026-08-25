import { writeBrainFile } from './journal';
/**
 * Workplace communicator — keeps Open-Chat (and email/call) updated on the
 * ongoing state of the workplace: money made, issues, insights, upgrades.
 *
 * Each day phase produces a recap; recaps are pushed to Open-Chat + emailed,
 * and the evening recap is also prepared for a voice call (Aetherdesk).
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface PhaseRecap {
  phase: "morning" | "midday" | "evening" | "night";
  generatedAt: string;
  sections: {
    money?: string;
    issues?: string;
    insights?: string;
    upgrades?: string;
  };
  summary: string;
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const FILE = path.join(DIR, "recaps.json");

async function readRecaps(): Promise<PhaseRecap[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as { recaps?: PhaseRecap[] };
    return Array.isArray(parsed.recaps) ? parsed.recaps : [];
  } catch {
    return [];
  }
}

/** Gather the day's workplace signals for a recap. */
export async function buildRecap(phase: PhaseRecap["phase"]): Promise<PhaseRecap> {
  const money: string[] = [];
  const issues: string[] = [];
  const insights: string[] = [];
  const upgrades: string[] = [];

  // Money — from the business pipeline + treasury.
  try {
    const { pipelineSummary } = await import("./business-pipeline");
    const { settledRevenueUsd } = await import("./treasury-state");
    const revenueToDate = await settledRevenueUsd();
    const p = await pipelineSummary(revenueToDate);
    money.push(`Settled revenue: $${revenueToDate}. Pipeline: $${p.opportunities.activePipelineValue} active, $${p.opportunities.wonMonthlyValue} won/mo. Target $${p.monthlyTarget}/mo.`);
  } catch { /* pipeline unavailable */ }

  // Issues — from self-learning lessons + repair log.
  try {
    const { getLessons } = await import("./self-learning");
    const lessons = await getLessons();
    if (lessons.length) issues.push(`${lessons.length} lesson(s): ${lessons.slice(0, 3).map((l) => l.pattern).join("; ")}`);
    else issues.push("No recurring issues.");
  } catch { /* n/a */ }

  // Insights — from the news digest + R&D.
  try {
    const { newsDigest } = await import("./news");
    const digest = await newsDigest();
    if (digest.items.length) insights.push(`News: ${digest.items.slice(0, 3).map((i) => i.title).join(" | ")}`);
  } catch { /* n/a */ }

  // Upgrades — from the R&D dev queue.
  try {
    const { rdNightReport } = await import("./rd-night");
    const rd = await rdNightReport();
    const dev = rd.tasks.filter((t) => t.kind === "dev" && t.status === "queued");
    if (dev.length) upgrades.push(`Dev queue: ${dev.slice(0, 3).map((t) => t.title).join(" | ")}`);
  } catch { /* n/a */ }

  const summary = `${phase === "night" ? "Night" : phase[0].toUpperCase() + phase.slice(1)} recap: ${money[0] ?? "money n/a"}`;
  return {
    phase,
    generatedAt: new Date().toISOString(),
    sections: { money: money[0], issues: issues[0], insights: insights[0], upgrades: upgrades[0] },
    summary,
  };
}

export function renderRecap(recap: PhaseRecap): string {
  const lines = [`# ${recap.phase[0].toUpperCase()}${recap.phase.slice(1)} Recap — ${recap.generatedAt.slice(0, 10)}`, ""];
  for (const [label, text] of Object.entries(recap.sections)) {
    if (text) lines.push(`**${label}:** ${text}`, "");
  }
  return lines.join("\n");
}

export async function saveRecap(recap: PhaseRecap): Promise<PhaseRecap[]> {
  const recaps = await readRecaps();
  recaps.push(recap);
  await writeBrainFile(FILE, JSON.stringify({ recaps: recaps.slice(-200), updatedAt: new Date().toISOString() }, null, 2), "append", "communicator");
  return recaps;
}

/**
 * Send a recap to the configured channels:
 *   - Open-Chat (via its incoming webhook, if OPENCHAT_WEBHOOK set)
 *   - Email (Gmail nodemailer, if GMAIL_USER set)
 * Returns per-channel status.
 */
export async function sendRecap(recap: PhaseRecap): Promise<{ channels: string[]; detail: string[] }> {
  const channels: string[] = [];
  const detail: string[] = [];
  const markdown = renderRecap(recap);

  // Open-Chat webhook (the workplace communicator).
  const webhook = process.env.OPENCHAT_WEBHOOK;
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: markdown, channel: "workplace" }),
        signal: AbortSignal.timeout(10_000),
      });
      channels.push("openchat");
      detail.push(`openchat HTTP ${res.status}`);
    } catch (err) {
      detail.push(`openchat: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    detail.push("openchat: OPENCHAT_WEBHOOK not configured");
  }

  // ntfy push (tagged "recap") so Open-Chat on the phone can auto-speak it.
  const ntfyBase = process.env.NTFY_URL;
  const ntfyTopic = process.env.NTFY_TOPIC_RECAPS ?? process.env.NTFY_TOPIC_RESULTS;
  if (ntfyBase && ntfyTopic) {
    try {
      const res = await fetch(ntfyBase.replace(/\/+$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          topic: ntfyTopic,
          title: `Draymond ${recap.phase} recap`,
          message: recap.summary,
          tags: ["recap"],
          priority: 3,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      channels.push("ntfy");
      detail.push(`ntfy HTTP ${res.status}`);
    } catch (err) {
      detail.push(`ntfy: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    detail.push("ntfy: NTFY_URL/TOPIC not configured");
  }

  // Email via the existing Gmail memo path.
  if (process.env.GMAIL_USER || process.env.DRAYMOND_ALERT_EMAIL) {
    try {
      const { sendMemo } = await import("./notifications");
      await sendMemo(`Overlay365 ${recap.phase} recap — ${recap.generatedAt.slice(0, 10)}`, markdown);
      channels.push("email");
      detail.push("email sent");
    } catch (err) {
      detail.push(`email: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    detail.push("email: GMAIL_USER/ALERT_EMAIL not configured");
  }

  return { channels, detail };
}
