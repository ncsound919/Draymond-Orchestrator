import { listJobs } from '@/lib/draymond/scheduler';
import { listChains } from '@/lib/draymond/chains';
import SchedulesDashboard from './SchedulesDashboard';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  let serializedJobs: Record<string, unknown>[] = [];
  let chainOptions: { id: string; name: string; slug: string }[] = [];

  try {
    const [jobs, chains] = await Promise.all([
      listJobs(),
      listChains({ is_template: true }),
    ]);
    serializedJobs = jobs.map((j) => ({ ...j }));
    chainOptions = chains.map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
  } catch (err) {
    console.error('[SchedulesPage] Failed to load schedules:', err);
    // Continue with empty arrays — dashboard will show empty state
  }

  return (
    <div className="min-h-screen text-white">
      <SchedulesDashboard initialJobs={serializedJobs as any} chainOptions={chainOptions} />
    </div>
  );
}
