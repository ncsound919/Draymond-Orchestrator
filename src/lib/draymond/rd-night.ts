/**
 * Night mode — overnight Research & Development.
 *
 * While the user sleeps, the fleet works a night shift: pick research topics
 * (from the news digest + a backlog) and dev tasks, queue them, and produce a
 * morning R&D brief. Topics are ranked by mission relevance (E1-E4).
 */

import fs from "node:fs/promises";
import path from "node:path";

export interface RdTask {
  id: string;
  kind: "research" | "dev";
  title: string;
  assignee: string;
  priority: 1 | 2 | 3;
  status: "queued" | "done";
}

const DIR = process.env.DRAYMOND_REGISTRY_DIR ?? path.join(process.cwd(), ".draymond");
const FILE = path.join(DIR, "rd-night.json");

export const RD_DEV_BACKLOG: Array<{ title: string; assignee: string; priority: 1 | 2 | 3 }> = [
  { title: "Wealth tier: ghostfolio portfolio page", assignee: "ghostfolio-engine", priority: 1 },
  { title: "Aetherdesk: multi-tenant onboarding flow", assignee: "aetherdesk", priority: 1 },
  { title: "Marketing: next-day content calendar", assignee: "social-media-dashboard", priority: 2 },
  { title: "Auditor: add form-interaction tests to QA suite", assignee: "agent-browser", priority: 2 },
  { title: "BookBridge: wire zvec vector index for semantic search", assignee: "bookbridge", priority: 3 },
];

async function readTasks(): Promise<RdTask[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as { tasks?: RdTask[] };
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch {
    return [];
  }
}

async function writeTasks(tasks: RdTask[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ tasks, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

/** Build the night shift plan: research topics from news + dev backlog. */
export async function buildNightPlan(newsTopics: string[] = []): Promise<{ tasks: RdTask[]; brief: string }> {
  const existing = await readTasks();
  const seen = new Set(existing.map((t) => t.title));

  const tasks: RdTask[] = [...existing];
  let rank = 1;
  for (const topic of newsTopics.slice(0, 5)) {
    if (seen.has(topic)) continue;
    seen.add(topic);
    tasks.push({
      id: `rd_${Date.now()}_${rank}`, kind: "research", title: `Research: ${topic}`,
      assignee: "omniresearch-pro", priority: (rank <= 2 ? 1 : rank <= 4 ? 2 : 3) as 1 | 2 | 3, status: "queued",
    });
    rank++;
  }
  for (const dev of RD_DEV_BACKLOG) {
    if (seen.has(dev.title)) continue;
    seen.add(dev.title);
    tasks.push({
      id: `rd_${Date.now()}_${rank}`, kind: "dev", title: dev.title, assignee: dev.assignee, priority: dev.priority, status: "queued",
    });
    rank++;
  }

  await writeTasks(tasks.slice(-200));
  const research = tasks.filter((t) => t.kind === "research");
  const dev = tasks.filter((t) => t.kind === "dev");
  const brief =
    `Overnight R&D plan (${tasks.length} queued): ${research.length} research, ${dev.length} dev.\n` +
    research.slice(0, 3).map((t) => `  - ${t.title} (${t.assignee})`).join("\n") +
    (dev.length ? `\nDev queue top: ${dev.slice(0, 3).map((t) => t.title).join(" | ")}` : "");
  return { tasks, brief };
}

export async function markTaskDone(id: string): Promise<RdTask | null> {
  const tasks = await readTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  task.status = "done";
  await writeTasks(tasks);
  return task;
}

export async function rdNightReport(): Promise<{ tasks: RdTask[]; updatedAt: string }> {
  const tasks = await readTasks();
  return { tasks, updatedAt: new Date().toISOString() };
}
