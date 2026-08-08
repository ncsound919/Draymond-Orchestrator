import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import IdeSessionView from '@/components/ide/IdeSessionView';

export const metadata: Metadata = {
  title: 'IDE Session | Draymond Orchestrator',
  description: 'Watch the coding team work live and interject.',
};

export default async function IdeSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireDraymondAuth();
  if (auth.error) redirect('/login');

  const { id } = await params;

  return (
    <div className="h-[calc(100vh-6rem)]">
      <IdeSessionView sessionId={id} />
    </div>
  );
}
