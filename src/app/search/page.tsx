import type { Metadata } from 'next';
import SearchClient from './SearchClient';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search posts, listings, and news across The Uplift Lab.',
};

export default async function SearchPage(
  props: { searchParams: Promise<{ q?: string }> }
) {
  const searchParams = await props.searchParams;
  const initialQuery = searchParams.q ?? '';

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Search</h1>
        <p className="text-white/40 mb-8">Find posts, businesses, and news across the community.</p>
        <SearchClient initialQuery={initialQuery} />
      </div>
    </div>
  );
}
