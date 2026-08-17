// ============================================================================
// SEO — pure helpers (unit-tested, no network)
// ============================================================================
import type { SeoPriority, SeoTask } from '@/lib/command-center/types';

export type SeoFilter = 'all' | 'todo' | 'in_progress' | 'blocked' | 'done';

const FALLBACK_PRIORITY_CLASSES = 'bg-gray-500/20 text-gray-400';

/** Tailwind badge classes for a task priority. Unknown priorities fall back to gray. */
export function priorityColor(
  priority: SeoPriority | string | null | undefined,
): string {
  switch (priority) {
    case 'low':
      return 'bg-gray-500/20 text-gray-400';
    case 'medium':
      return 'bg-blue-500/20 text-blue-400';
    case 'high':
      return 'bg-yellow-500/20 text-yellow-400';
    case 'urgent':
      return 'bg-red-500/20 text-red-400';
    default:
      return FALLBACK_PRIORITY_CLASSES;
  }
}

/** Client-side filter over the fetched task list. */
export function seoFilter(
  tasks: SeoTask[] | null | undefined,
  filter: SeoFilter,
): SeoTask[] {
  const all = tasks ?? [];
  if (filter === 'all') return all;
  if (filter === 'done') return all.filter((t) => t.is_done || t.status === 'done');
  return all.filter((t) => t.status === filter);
}
