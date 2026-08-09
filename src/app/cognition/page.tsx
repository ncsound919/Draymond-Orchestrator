export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import { kairosFeed } from '@/lib/draymond/kairos';
import { dreamReport } from '@/lib/draymond/dream-cycle';
import { listUltraplans } from '@/lib/draymond/ultraplan';
import KairosFeed from '@/components/cognition/KairosFeed';
import DreamReport from '@/components/cognition/DreamReport';
import UltraplanQueue from '@/components/cognition/UltraplanQueue';

export const metadata: Metadata = {
  title: 'Cognition | Draymond Orchestrator',
  description: 'Kairos moments · AutoDream consolidation · Ultraplan deep-planning queue',
};

export default async function CognitionPage() {
  let feed;
  let dream;
  let plans;
  try {
    [feed, dream, plans] = await Promise.all([
      kairosFeed({ limit: 50 }),
      dreamReport(),
      listUltraplans(),
    ]);
  } catch (err) {
    console.error('[CognitionPage] failed to load cognition data:', err);
    return (
      <div className="min-h-screen text-white">
        <div className="max-w-7xl mx-auto px-4 py-24 text-center">
          <p className="text-5xl mb-4 opacity-40">&#x26A0;</p>
          <h1 className="text-xl font-bold mb-2">Failed to load cognition data</h1>
          <p className="text-white/40 text-sm">Check the registry state and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Cognition</h1>
          <p className="mt-1 text-sm text-gray-400">
            Kairos moments · AutoDream consolidation · Ultraplan deep planning
          </p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Kairos Feed</h2>
          <KairosFeed moments={feed} />
        </section>
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Dream Report</h2>
          <DreamReport report={dream.latest} />
        </section>
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Ultraplan Queue</h2>
          <UltraplanQueue plans={plans} />
        </section>
      </div>
    </div>
  );
}
