'use client';
import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import type { Post, PostType } from '@/lib/supabase/types';
import { createClient } from '@/lib/supabase/client';

const MODULE_COLORS: Record<string, string> = {
  learn: 'bg-blue-900/30 text-blue-400',
  health: 'bg-green-900/30 text-green-400',
  wealth: 'bg-yellow-900/30 text-yellow-400',
  ventures: 'bg-orange-900/30 text-orange-400',
  justice: 'bg-purple-900/30 text-purple-400',
  community: 'bg-red-900/30 text-red-400',
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  story: { label: 'Story', color: 'bg-[#22c55e]/10 text-[#22c55e]' },
  mutual_aid_request: { label: 'Needs Help', color: 'bg-orange-900/30 text-orange-400' },
  mutual_aid_offer: { label: 'Offering Help', color: 'bg-green-900/30 text-green-400' },
  event: { label: 'Event', color: 'bg-blue-900/30 text-blue-400' },
  announcement: { label: 'Announcement', color: 'bg-purple-900/30 text-purple-400' },
};

type FilterKey = 'all' | 'stories' | 'mutual_aid' | 'events';

const FILTERS: { key: FilterKey; label: string; types: PostType[] | null }[] = [
  { key: 'all', label: 'All', types: null },
  { key: 'stories', label: 'Stories', types: ['story'] },
  { key: 'mutual_aid', label: 'Mutual Aid', types: ['mutual_aid_request', 'mutual_aid_offer'] },
  { key: 'events', label: 'Events', types: ['event'] },
];

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PostCard({ post, userId }: { post: Post; userId: string | null }) {
  const [reacted, setReacted] = useState(post.user_reacted ?? false);
  const [count, setCount] = useState(post.reaction_count ?? 0);
  const [isPending, startTransition] = useTransition();

  async function toggleReaction() {
    if (!userId) return;
    const supabase = createClient();
    startTransition(async () => {
      if (reacted) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
        await (supabase as any).from('post_reactions').delete().eq('post_id', post.id).eq('user_id', userId);
        setReacted(false);
        setCount(c => c - 1);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
        await (supabase as any).from('post_reactions').insert({ post_id: post.id, user_id: userId, reaction_type: 'uplift' });
        setReacted(true);
        setCount(c => c + 1);
      }
    });
  }

  const typeInfo = TYPE_LABELS[post.type] ?? { label: post.type, color: 'bg-white/5 text-white/40' };
  const author = post.author as { username?: string; display_name?: string } | undefined;

  return (
    <article className="glass-card p-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-full bg-[#dc2626]/20 flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-[#dc2626]">
              {(author?.display_name ?? author?.username ?? '?')[0].toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <Link href={`/profile/${author?.username ?? ''}`}
              className="font-semibold text-white text-sm hover:underline truncate block">
              {author?.display_name ?? author?.username ?? 'Anonymous'}
            </Link>
            <span className="text-xs text-white/40">{formatRelative(post.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeInfo.color}`}>{typeInfo.label}</span>
          {post.module && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${MODULE_COLORS[post.module] ?? 'bg-white/5 text-white/40'}`}>
              {post.module}
            </span>
          )}
        </div>
      </div>

      <h3 className="font-semibold text-white mb-1.5">{post.title}</h3>
      {post.body && <p className="text-white/50 text-sm leading-relaxed line-clamp-3">{post.body}</p>}

      {post.tags?.length > 0 && (
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {post.tags.map(tag => (
            <span key={tag} className="text-xs bg-white/5 text-white/40 border border-white/10 px-2 py-0.5 rounded-full">#{tag}</span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/5">
        <button
          onClick={toggleReaction}
          disabled={!userId || isPending}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
            reacted ? 'text-[#22c55e]' : 'text-white/40 hover:text-[#22c55e]'
          } disabled:cursor-not-allowed`}
          aria-label={reacted ? 'Remove uplift' : 'Uplift this post'}
        >
          <span>{reacted ? '⭐' : '☆'}</span>
          <span>{count > 0 ? count : ''} Uplift</span>
        </button>
        {!userId && (
          <Link href="/auth/login" className="text-xs text-white/30 hover:text-[#22c55e] ml-auto">
            Sign in to react
          </Link>
        )}
      </div>
    </article>
  );
}

export default function NetworkFeed({ initialPosts, userId }: { initialPosts: Post[]; userId: string | null }) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  const filteredPosts = useMemo(() => {
    const filterDef = FILTERS.find((f) => f.key === activeFilter);
    if (!filterDef || !filterDef.types) return initialPosts;
    return initialPosts.filter((post) => filterDef.types!.includes(post.type));
  }, [initialPosts, activeFilter]);

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap" aria-label="Filter posts">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            aria-pressed={activeFilter === filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeFilter === filter.key
                ? 'bg-[#2d4a1a] text-white border-[#2d4a1a]'
                : 'bg-white border-[#1a1a1a]/10 text-[#1a1a1a]/70 hover:bg-[#2d4a1a] hover:text-white hover:border-[#2d4a1a]'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filteredPosts.length === 0 ? (
        <div className="text-center py-20 text-[#1a1a1a]/40">
          <p className="text-5xl mb-4">&#127775;</p>
          <h3 className="font-semibold text-lg text-[#1a1a1a]/60 mb-2">
            {activeFilter === 'all' ? 'The feed is quiet' : `No ${FILTERS.find(f => f.key === activeFilter)?.label.toLowerCase()} posts yet`}
          </h3>
          <p className="text-sm">Be the first to share a story or request help.</p>
          {userId ? (
            <Link href="/network/new"
              className="mt-4 inline-block px-5 py-2.5 bg-[#c8a415] text-[#2d4a1a] font-semibold rounded-full hover:bg-[#e0b920] text-sm">
              Share something
            </Link>
          ) : (
            <Link href="/auth/signup"
              className="mt-4 inline-block px-5 py-2.5 bg-[#c8a415] text-[#2d4a1a] font-semibold rounded-full hover:bg-[#e0b920] text-sm">
              Join the community
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map(post => (
            <PostCard key={post.id} post={post} userId={userId} />
          ))}
        </div>
      )}
    </div>
  );
}
