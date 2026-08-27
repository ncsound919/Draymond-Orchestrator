// src/lib/visualizer/snapshot.ts
import { serviceCatalog, probeAllServices } from '@/lib/draymond/service-manager';
import { getHeartbeats } from '@/lib/draymond/heartbeat';
import { listJobs } from '@/lib/draymond/scheduler';
import { settledRevenueUsd } from '@/lib/draymond/treasury-state';
import { isDegraded } from '@/lib/draymond/fallbacks';
import { kairosFeed } from '@/lib/draymond/kairos';

export type ServiceHealthLike = { slug: string; name: string; url: string | null; up: boolean; detail: string; statusCode?: number | null };
export type ServiceCatalogLike = { slug: string; name: string; port: number | null; health: string; env: string };
export type HeartbeatLike = { slug: string; name: string; last_seen: string; up: boolean; detail: string };
export type JobLike = { id: string; name: string; next_run_at: string | null; last_run_status: string };

/** Best-effort port extraction from a health URL (fallback when the catalog
 * doesn't carry the port — e.g. unit-test fixtures or unmapped slugs). */
function portFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.port ? Number(parsed.port) : null;
  } catch {
    return null;
  }
}

export function normalizeServices(services: Array<ServiceHealthLike & Partial<ServiceCatalogLike>>): Array<{
  slug: string; name: string; category: string; port: number | null; up: boolean;
}> {
  return services.map((s) => ({
    slug: s.slug,
    name: s.name,
    category: s.port === 3444 ? 'control' : inferCategory(s.slug),
    port: s.port ?? portFromUrl(s.url),
    up: s.up,
  }));
}

function inferCategory(slug: string): string {
  if (['litellm', 'dsh-harness', 'opencode'].includes(slug)) return 'coding';
  if (['claw-protect', 'depscan', 'nuclei', 'keywire'].includes(slug)) return 'security';
  if (['reporank', 'grader'].includes(slug)) return 'review';
  if (['agent-browser', 'hermes-brain', 'scheduler'].includes(slug)) return 'orchestration';
  return 'service';
}

export function normalizeAgents(heartbeats: Record<string, HeartbeatLike>): Array<{ slug: string; name: string; up: boolean }> {
  return Object.values(heartbeats).map((h) => ({ slug: h.slug, name: h.name, up: h.up }));
}

export function normalizeJobs(jobs: JobLike[]): JobLike[] {
  return jobs.map((j) => ({ id: j.id, name: j.name, next_run_at: j.next_run_at, last_run_status: j.last_run_status }));
}

export async function buildVisualizerSnapshot() {
  const catalog = serviceCatalog();
  const catalogBySlug = new Map(catalog.map((c) => [c.slug, c]));
  const [services, heartbeats, jobs, moments, revenueUsd, degraded] = await Promise.all([
    probeAllServices(),
    getHeartbeats(),
    listJobs({ limit: 100 }),
    kairosFeed({ limit: 100 }),
    settledRevenueUsd(),
    isDegraded(),
  ]);
  const merged = services.map((s) => {
    const c = catalogBySlug.get(s.slug);
    return { ...s, ...(c ?? { port: null }) };
  });
  const upCount = services.filter((s) => s.up).length;
  return {
    services: normalizeServices(merged),
    agents: normalizeAgents(heartbeats),
    jobs: normalizeJobs(jobs),
    moments: moments.map((m) => ({
      id: m.id, kind: m.kind, severity: m.severity, title: m.title, source: m.source, acked: m.acked,
    })),
    revenueUsd,
    degraded,
    servicesUp: upCount,
    servicesTotal: services.length,
    checkedAt: new Date().toISOString(),
  };
}