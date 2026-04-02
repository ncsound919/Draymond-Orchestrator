import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Dashboard | The Uplift Lab',
};

type PendingListing = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  location_city: string | null;
  location_state: string | null;
  created_at: string;
  owner: { display_name: string | null; username: string } | null;
};

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/auth/login');

  // Check admin role
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
  const sb = supabase as any;

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null };

  if (!profile || profile.role !== 'admin') {
    redirect('/');
  }

  const [
    { count: userCount },
    { count: postCount },
    { count: listingCount },
    { count: newsCount },
    { data: pendingListings },
    { data: recentPosts },
  ] = await Promise.all([
    sb.from('profiles').select('*', { count: 'exact', head: true }),
    sb.from('posts').select('*', { count: 'exact', head: true }),
    sb.from('registry_listings').select('*', { count: 'exact', head: true }),
    sb.from('news_articles').select('*', { count: 'exact', head: true }),
    sb.from('registry_listings')
      .select('*, owner:profiles(display_name, username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10),
    sb.from('posts')
      .select('id, title, type, status, created_at, author:profiles(username)')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const stats = [
    { label: 'Total Users', value: userCount ?? 0, color: 'text-[#22c55e]' },
    { label: 'Network Posts', value: postCount ?? 0, color: 'text-blue-400' },
    { label: 'Registry Listings', value: listingCount ?? 0, color: 'text-yellow-400' },
    { label: 'News Articles', value: newsCount ?? 0, color: 'text-purple-400' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero bar */}
      <div className="bg-[#0a0a0a] border-b border-white/5 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Manage content, users, and platform operations
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="glass-card p-6 text-center">
              <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="text-sm text-white/40 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Pending listings */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Pending Listings
              {(pendingListings as PendingListing[])?.length > 0 && (
                <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#dc2626]/20 text-[#dc2626]">
                  {(pendingListings as PendingListing[]).length}
                </span>
              )}
            </h2>
            {(pendingListings as PendingListing[])?.length > 0 ? (
              <div className="space-y-3">
                {(pendingListings as PendingListing[]).map((listing) => (
                  <div
                    key={listing.id}
                    className="p-3 rounded-lg bg-white/[0.03] border border-white/5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-white text-sm">
                          {listing.name}
                        </p>
                        <p className="text-xs text-white/30 mt-0.5">
                          {listing.category ?? 'Uncategorized'} &middot;{' '}
                          {listing.owner?.display_name ?? listing.owner?.username ?? 'Unknown'}
                        </p>
                      </div>
                      <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded-full">
                        Pending
                      </span>
                    </div>
                    <p className="text-xs text-white/40 mt-2 line-clamp-2">
                      {listing.description}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/30">No pending listings.</p>
            )}
          </div>

          {/* Recent posts */}
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">
              Recent Posts
            </h2>
            {recentPosts?.length > 0 ? (
              <div className="space-y-3">
                {(recentPosts as { id: string; title: string; type: string; status: string; created_at: string; author: { username: string } | null }[]).map(
                  (post) => (
                    <div
                      key={post.id}
                      className="p-3 rounded-lg bg-white/[0.03] border border-white/5"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            href={`/network/${post.id}`}
                            className="font-medium text-white text-sm hover:text-[#22c55e] transition-colors"
                          >
                            {post.title}
                          </Link>
                          <p className="text-xs text-white/30 mt-0.5">
                            {post.type} &middot; @{post.author?.username ?? 'unknown'} &middot;{' '}
                            {new Date(post.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            post.status === 'active'
                              ? 'text-green-400 bg-green-900/30'
                              : 'text-white/40 bg-white/5'
                          }`}
                        >
                          {post.status}
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <p className="text-sm text-white/30">No posts yet.</p>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/network"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              View Network
            </Link>
            <Link
              href="/registry"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              View Registry
            </Link>
            <Link
              href="/news"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              View News
            </Link>
            <Link
              href="/search"
              className="px-4 py-2 text-sm font-medium rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
            >
              Search
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
