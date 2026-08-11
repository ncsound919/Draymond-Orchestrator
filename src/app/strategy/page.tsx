import type { Metadata } from 'next';
import { StrategyRunner } from '@/components/strategy/StrategyRunner';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Strategy Team | Draymond Orchestrator',
  description: 'Run Overlay365 strategy agents: intel briefs and venture proposals.',
};

export default function StrategyPage() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold tracking-tight text-white">Strategy Team</h1>
          <p className="mt-1 text-sm text-gray-400">
            Run the Overlay365 Strategist &mdash; intel briefs, venture proposals, and feedback clustering.
          </p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <StrategyRunner />
      </div>
    </div>
  );
}
