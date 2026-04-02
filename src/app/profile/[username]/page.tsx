import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

interface Props { params: Promise<{ username: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `${username}'s profile on The Uplift Lab`,
  };
}

export default async function ProfilePage({ params }: Props) {
  const { username } = await params;
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single();

  if (!profile) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
  const { data: posts } = await (supabase as any)
    .from('posts')
    .select('*')
    .eq('author_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(20);

  const { data: { user } } = await supabase.auth.getUser();
  const isOwn = user?.id === profile.id;

  const roleLabel = profile.role.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Profile header */}
      <div className="bg-[#0a0a0a] border-b border-white/5 text-white">
        <div className="max-w-4xl mx-auto px-4 py-10">
          <div className="flex items-start gap-6">
            <div className="w-20 h-20 rounded-full bg-[#dc2626] flex items-center justify-center shrink-0">
              <span className="text-3xl font-bold text-white">
                {(profile.display_name ?? profile.username)[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold">{profile.display_name ?? profile.username}</h1>
              <p className="text-white/40 text-sm">@{profile.username}</p>
              {profile.short_bio && <p className="mt-2 text-white/60 text-sm">{profile.short_bio}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="text-xs bg-white/10 px-3 py-1 rounded-full">{roleLabel}</span>
                {profile.location_city && (
                  <span className="text-xs bg-white/10 px-3 py-1 rounded-full">
                    {profile.location_city}{profile.location_state ? `, ${profile.location_state}` : ''}
                  </span>
                )}
                {(profile.modules ?? []).map((m: string) => (
                  <span key={m} className="text-xs bg-[#22c55e]/20 text-[#22c55e] px-3 py-1 rounded-full capitalize">{m}</span>
                ))}
              </div>
            </div>
            {isOwn && (
              <Link href="/profile/edit"
                className="px-4 py-2 text-sm font-medium border border-white/10 rounded-full hover:bg-white/10 transition-colors">
                Edit profile
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Posts */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold text-white mb-4">Posts by @{profile.username}</h2>
        {!posts || posts.length === 0 ? (
          <div className="text-center py-16 text-white/30">
            <p className="text-4xl mb-3">&#9998;</p>
            <p className="font-medium text-white/50">No posts yet.</p>
            {isOwn && (
              <Link href="/network/new"
                className="mt-4 inline-block px-5 py-2.5 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] text-sm shadow-lg shadow-red-900/20">
                Share your first post
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post: Record<string, string>) => (
              <article key={post.id} className="bg-white rounded-2xl border border-[#1a1a1a]/10 p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium bg-[#22c55e]/10 text-[#22c55e] px-2 py-0.5 rounded-full capitalize">
                    {post.type.replace(/_/g, ' ')}
                  </span>
                  {post.module && (
                    <span className="text-xs font-medium bg-white/5 text-white/40 px-2 py-0.5 rounded-full capitalize">{post.module}</span>
                  )}
                  <span className="text-xs text-white/30 ml-auto">
                    {new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                <h3 className="font-semibold text-white">{post.title}</h3>
                {post.body && <p className="text-sm text-white/50 mt-1 line-clamp-2">{post.body}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
