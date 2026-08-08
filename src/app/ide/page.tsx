import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import IdeList from '@/components/ide/IdeList';

export const metadata: Metadata = {
  title: 'Agent IDE | Draymond Orchestrator',
  description: 'Deploy the coding team, watch them work live, interject when needed.',
};

export default async function IdePage() {
  const auth = await requireDraymondAuth();
  if (auth.error) redirect('/login');

  return (
    <div className="h-[calc(100vh-6rem)]">
      <IdeList />
    </div>
  );
}
