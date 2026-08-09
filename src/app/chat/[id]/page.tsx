import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { requireDraymondAuth } from '@/lib/draymond/auth';
import { getConversation, listMessages } from '@/lib/draymond/chat-store';
import ChatClient from '@/components/chat/ChatClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const auth = await requireDraymondAuth();
  if (auth.error) return { title: 'Chat | Draymond Orchestrator' };
  const conversation = await getConversation(id, auth.user.id).catch(() => null);
  return {
    title: `${conversation?.title ?? 'Chat'} | Draymond Orchestrator`,
  };
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireDraymondAuth();
  if (auth.error) redirect('/login');

  const { id } = await params;
  const conversation = await getConversation(id, auth.user.id).catch(() => null);
  if (!conversation) notFound();

  const messages = await listMessages(id).catch(() => []);

  return (
    <ChatClient
      userEmail={auth.user.email}
      conversationId={id}
      initialTitle={conversation.title}
      initialMessages={messages}
    />
  );
}
