'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

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

export default function SubmitListingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [website, setWebsite] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/auth/login'); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const { error: insertError } = await (supabase as any).from('registry_listings').insert({
      owner_id: user.id,
      name,
      description,
      category: category || null,
      website: website || null,
      location_city: city || null,
      location_state: state || null,
      status: 'pending',
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
    } else {
      toast.success('Listing submitted for review!');
      router.push('/registry');
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/registry" className="text-sm text-white/40 hover:text-white flex items-center gap-1 transition-colors">
            &larr; Back to registry
          </Link>
          <h1 className="text-3xl font-bold text-white mt-4">Submit a Listing</h1>
          <p className="text-white/50 mt-1">Add your Black-owned business or organization to the directory.</p>
        </div>

        <div className="glass-card p-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/30 text-red-400 border border-red-800">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="name">
                Business / Organization Name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="Your business name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="description">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="description"
                rows={4}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30 resize-none"
                placeholder="Describe your business, services, and what makes it special..."
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="category">
                  Category
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white"
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="website">
                  Website
                </label>
                <input
                  id="website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="https://yourbusiness.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="city">City</label>
                <input
                  id="city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="Atlanta"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="state">State</label>
                <input
                  id="state"
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="GA"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors disabled:opacity-50 shadow-lg shadow-red-900/20"
            >
              {loading ? 'Submitting...' : 'Submit Listing'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
