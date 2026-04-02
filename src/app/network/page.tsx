import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import NetworkFeed from '@/components/NetworkFeed';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Network | The Uplift Lab',
  description: 'Connect, share, and support your community across all six Uplift Lab modules.',
};

export default async function NetworkPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: posts } = await supabase
    .from('posts')
    .select(`
      *,
      author:profiles(id, username, display_name, avatar_url, role),
      reaction_count:post_reactions(count)
    `)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(30);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero bar */}
      <div className="bg-[#0a0a0a] border-b border-white/5 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Uplift Network</h1>
            <p className="text-white/40 text-sm mt-0.5">Stories, mutual aid, and community wins</p>
          </div>
          {user ? (
            <Link href="/network/new"
              className="px-5 py-2.5 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors text-sm shadow-lg shadow-red-900/20">
              + Share something
            </Link>
          ) : (
            <Link href="/auth/signup"
              className="px-5 py-2.5 bg-[#22c55e] text-[#0a0a0a] font-semibold rounded-full hover:bg-[#4ade80] transition-colors text-sm shadow-lg shadow-green-900/20">
              Join to participate
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main feed */}
        <div className="lg:col-span-2">
          <NetworkFeed initialPosts={posts ?? []} userId={user?.id ?? null} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick request */}
          <div className="glass-card p-6">
            <h3 className="font-semibold text-white mb-3">Need something?</h3>
            <p className="text-sm text-white/40 mb-4">Post a mutual aid request — food, transport, childcare, rent, and more.</p>
            {user ? (
              <Link href="/network/new?type=mutual_aid_request"
                className="block text-center w-full py-2.5 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors text-sm shadow-lg shadow-red-900/20">
                Request help
              </Link>
            ) : (
              <Link href="/auth/signup"
                className="block text-center w-full py-2.5 border border-[#22c55e]/30 text-[#22c55e] font-semibold rounded-full hover:bg-[#22c55e]/10 transition-colors text-sm">
                Sign up to request help
              </Link>
            )}
          </div>

          {/* Modules */}
          <div className="glass-card p-6">
            <h3 className="font-semibold text-white mb-3">Explore modules</h3>
            <div className="space-y-2">
              {[
                { name: 'Learn', href: '/modules/learn', color: 'bg-blue-900/30 text-blue-400' },
                { name: 'Health', href: '/modules/health', color: 'bg-green-900/30 text-green-400' },
                { name: 'Wealth', href: '/modules/wealth', color: 'bg-yellow-900/30 text-yellow-400' },
                { name: 'Ventures', href: '/modules/ventures', color: 'bg-orange-900/30 text-orange-400' },
                { name: 'Justice', href: '/modules/justice', color: 'bg-purple-900/30 text-purple-400' },
                { name: 'Community', href: '/modules/community', color: 'bg-red-900/30 text-red-400' },
              ].map(m => (
                <Link key={m.name} href={m.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity ${m.color}`}>
                  Uplift {m.name}
                </Link>
              ))}
            </div>
          </div>

          {/* About */}
          <div className="glass-card p-6 border-[#22c55e]/20">
            <h3 className="font-semibold text-white mb-2">About the Network</h3>
            <p className="text-white/40 text-sm">A community-owned space to share wins, request help, and build power together. No ads, no algorithms optimizing for outrage.</p>
            <Link href="/about" className="mt-3 inline-block text-[#22c55e] text-sm font-medium hover:underline">Learn more &rarr;</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
