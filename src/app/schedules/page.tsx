import { listJobs } from '@/lib/draymond/scheduler';
import { listChains } from '@/lib/draymond/chains';
import SchedulesDashboard from './SchedulesDashboard';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const [jobs, chains] = await Promise.all([
    listJobs(),
    listChains({ is_template: true }),
  ]);

  // Serialize to plain objects for client component
  const serializedJobs = jobs.map((j) => ({ ...j }));
  const chainOptions = chains.map((c) => ({ id: c.id, name: c.name, slug: c.slug }));

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SchedulesDashboard initialJobs={serializedJobs} chainOptions={chainOptions} />
    </div>
  );
}
