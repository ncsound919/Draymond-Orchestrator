// ============================================================================
// Command Center — tab shell (client)
// ============================================================================
// Hosts the QueryClientProvider and the tabbed section layout. Each section
// panel is a client component in src/components/command-center/<section>/.
// ============================================================================
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePanel from './home/HomePanel';
import AgentsPanel from './agents/AgentsPanel';
import TasksPanel from './tasks/TasksPanel';
import SitesPanel from './sites/SitesPanel';
import BrainPanel from './brain/BrainPanel';
import SciencePanel from './science/SciencePanel';
import CrmPanel from './crm/CrmPanel';
import SeoPanel from './seo/SeoPanel';

const TABS = [
  { value: 'home', label: 'Home', component: HomePanel },
  { value: 'agents', label: 'Agents', component: AgentsPanel },
  { value: 'tasks', label: 'Tasks', component: TasksPanel },
  { value: 'sites', label: 'Sites', component: SitesPanel },
  { value: 'brain', label: 'Brain', component: BrainPanel },
  { value: 'science', label: 'Science', component: SciencePanel },
  { value: 'crm', label: 'CRM', component: CrmPanel },
  { value: 'seo', label: 'SEO', component: SeoPanel },
] as const;

export default function CommandCenterClient() {
  const [queryClient] = useState(() => new QueryClient());
  const [tab, setTab] = useState<string>('home');
  const Active = TABS.find((t) => t.value === tab)?.component ?? HomePanel;

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

          <div className="flex flex-wrap items-center gap-1 mb-6">
            {TABS.map((t) => (
              <button
                key={t.value}
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

          <Active />
        </div>
      </div>
    </QueryClientProvider>
  );
}
