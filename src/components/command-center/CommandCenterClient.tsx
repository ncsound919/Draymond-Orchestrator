// ============================================================================
// Command Center — tab shell (client)
// ============================================================================
// Hosts the QueryClientProvider and the tabbed section layout. Each section
// panel is a client component in src/components/command-center/<section>/.
// ============================================================================
'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePanel from './home/HomePanel';
import AgentsPanel from './agents/AgentsPanel';
import TasksPanel from './tasks/TasksPanel';
import SitesPanel from './sites/SitesPanel';
import BrainPanel from './brain/BrainPanel';
import SciencePanel from './science/SciencePanel';
import CrmPanel from './crm/CrmPanel';
import SeoPanel from './seo/SeoPanel';

// The PixiJS graph is heavy — load it only when the Visualizer tab is opened,
// never in the initial Command Center bundle.
const VisualizerTab = dynamic(() => import('@/components/visualizer/VisualizerApp'), {
  ssr: false,
  loading: () => <div className="py-10 text-sm text-white/50">Loading visualizer…</div>,
});

const TABS = [
  { value: 'home', label: 'Home' },
  { value: 'agents', label: 'Agents' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'sites', label: 'Sites' },
  { value: 'brain', label: 'Brain' },
  { value: 'science', label: 'Science' },
  { value: 'crm', label: 'CRM' },
  { value: 'seo', label: 'SEO' },
  { value: 'visualizer', label: 'Visualizer' },
] as const;

function ActivePanel({ tab }: { tab: string }) {
  switch (tab) {
    case 'agents': return <AgentsPanel />;
    case 'tasks': return <TasksPanel />;
    case 'sites': return <SitesPanel />;
    case 'brain': return <BrainPanel />;
    case 'science': return <SciencePanel />;
    case 'crm': return <CrmPanel />;
    case 'seo': return <SeoPanel />;
    case 'visualizer': return <VisualizerTab />;
    default: return <HomePanel />;
  }
}

export default function CommandCenterClient() {
  const [queryClient] = useState(() => new QueryClient());
  const [tab, setTab] = useState<string>('home');

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Command Center
              </h1>
              <p className="text-sm text-white/40 mt-1">
                Daily operations for the Overlay365 fleet &mdash; agents, tasks,
                sites, brain, science, CRM, and SEO.
              </p>
            </div>
          </div>

          <div role="tablist" aria-label="Command Center sections" className="flex flex-wrap items-center gap-1 mb-6">
            {TABS.map((t) => (
              <button
                key={t.value}
                role="tab"
                id={`cc-tab-${t.value}`}
                aria-selected={tab === t.value}
                aria-controls={`cc-panel-${t.value}`}
                onClick={() => setTab(t.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.value
                    ? 'text-white bg-white/10'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`cc-panel-${tab}`} aria-labelledby={`cc-tab-${tab}`}>
            <ActivePanel tab={tab} />
          </div>
        </div>
      </div>
    </QueryClientProvider>
  );
}
