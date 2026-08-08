import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import ChatClient from './ChatClient';

export const metadata: Metadata = {
  title: 'Chat | Draymond Orchestrator',
  description: 'Talk to Draymond — route tasks to the right tool with natural language.',
};

export default async function ChatPage() {
  const auth = await requireDraymondAuth();
  if (auth.error) redirect('/login');

  return (
    <div className="h-[calc(100vh-6rem)]">
      <ChatClient userEmail={auth.user.email} />
    </div>
  );
}
