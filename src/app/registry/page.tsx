import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Black Business Registry | The Uplift Lab',
  description:
    'Discover and support Black-owned businesses and organizations in your community.',
};

type RegistryListing = {
  id: string;
  name: string;
  description: string;
  category: string | null;
  website: string | null;
  location_city: string | null;
  location_state: string | null;
  status: string;
  created_at: string;
  owner: { display_name: string | null; username: string } | null;
};

export default async function RegistryPage(props: {
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
  let query = (supabase as any)
    .from('registry_listings')
    .select('*, owner:profiles(display_name, username)')
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (searchParams.category) {
    query = query.eq('category', searchParams.category);
  }
  if (searchParams.q) {
    query = query.or(
      `name.ilike.%${searchParams.q}%,description.ilike.%${searchParams.q}%`
    );
  }

  const { data: listings } = (await query) as { data: RegistryListing[] | null };

  const CATEGORIES = [
    'Restaurant',
    'Retail',
    'Professional Services',
    'Health & Wellness',
    'Education',
    'Technology',
    'Arts & Culture',
    'Nonprofit',
    'Other',
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero bar */}
      <div className="bg-[#0a0a0a] border-b border-white/5 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Black Business Registry</h1>
            <p className="text-white/40 text-sm mt-0.5">
              Discover and support Black-owned businesses
            </p>
          </div>
          {user ? (
            <Link
              href="/registry/submit"
              className="px-5 py-2.5 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors text-sm shadow-lg shadow-red-900/20"
            >
              + Add your business
            </Link>
          ) : (
            <Link
              href="/auth/signup"
              className="px-5 py-2.5 bg-[#22c55e] text-[#0a0a0a] font-semibold rounded-full hover:bg-[#4ade80] transition-colors text-sm shadow-lg shadow-green-900/20"
            >
              Join to add a listing
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Category filters */}
        <div className="flex flex-wrap gap-2 mb-8">
          <Link
            href="/registry"
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !searchParams.category
                ? 'bg-[#22c55e] text-[#0a0a0a]'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            All
          </Link>
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={`/registry?category=${encodeURIComponent(cat)}`}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                searchParams.category === cat
                  ? 'bg-[#22c55e] text-[#0a0a0a]'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {cat}
            </Link>
          ))}
        </div>

        {/* Listings grid */}
        {listings && listings.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <div key={listing.id} className="glass-card p-6 flex flex-col">
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">
                    {listing.name}
                  </h3>
                  {listing.category && (
                    <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-[#22c55e]/10 text-[#22c55e] whitespace-nowrap">
                      {listing.category}
                    </span>
                  )}
                </div>
                <p className="text-sm text-white/50 line-clamp-3 mb-4 flex-1">
                  {listing.description}
                </p>
                <div className="space-y-2 text-sm text-white/40">
                  {(listing.location_city || listing.location_state) && (
                    <p>
                      {[listing.location_city, listing.location_state]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  )}
                  {listing.website && (
                    <a
                      href={listing.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-[#22c55e] hover:underline"
                    >
                      Visit website &rarr;
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-card p-12 text-center">
            <p className="text-white/40 text-lg mb-4">
              {searchParams.q || searchParams.category
                ? 'No listings match your filters.'
                : 'No listings yet. Be the first to add one!'}
            </p>
            {user && (
              <Link
                href="/registry/submit"
                className="inline-block px-6 py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors shadow-lg shadow-red-900/20"
              >
                Submit a listing
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
