import { listJobs, type ScheduledJob } from '@/lib/draymond/scheduler';
import { listChains } from '@/lib/draymond/chains';
import SchedulesDashboard from './SchedulesDashboard';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  let serializedJobs: ScheduledJob[] = [];
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

  // The dashboard's local JobType excludes the internal 'decay_sweep' job;
  // surface those as 'custom' so they still render in the schedule list.
  const dashboardJobs = serializedJobs.map((j) => ({
    ...j,
    job_type: (j.job_type === 'decay_sweep' ? 'custom' : j.job_type) as 'chain' | 'health_check' | 'notification' | 'custom',
  }));

  return (
    <div className="min-h-screen text-white">
      <SchedulesDashboard initialJobs={dashboardJobs} chainOptions={chainOptions} />
    </div>
  );
}
