import CommandCenterClient from '@/components/command-center/CommandCenterClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Command Center | Draymond Orchestrator',
  description: 'Daily operations for the Overlay365 fleet — agents, tasks, sites, brain, science, CRM, and SEO.',
};

export default function CommandCenterPage() {
  return <CommandCenterClient />;
}
