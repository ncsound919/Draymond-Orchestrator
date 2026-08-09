import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import ChatLayout from '@/components/chat/ChatLayout';

export default async function ChatLayoutRoot({ children }: { children: ReactNode }) {
  const auth = await requireDraymondAuth();
  if (auth.error) redirect('/login');
  return <ChatLayout>{children}</ChatLayout>;
}
