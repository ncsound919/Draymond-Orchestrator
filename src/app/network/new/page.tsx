'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { PostType, UpliftModule } from '@/lib/supabase/types';

const POST_TYPES: { value: PostType; label: string }[] = [
  { value: 'story', label: 'Share a story or win' },
  { value: 'mutual_aid_request', label: 'Request help' },
  { value: 'mutual_aid_offer', label: 'Offer help' },
  { value: 'event', label: 'Post an event' },
  { value: 'announcement', label: 'Make an announcement' },
];

const MODULES: { value: UpliftModule; label: string }[] = [
  { value: 'learn', label: 'Uplift Learn' },
  { value: 'health', label: 'Uplift Health' },
  { value: 'wealth', label: 'Uplift Wealth' },
  { value: 'ventures', label: 'Uplift Ventures' },
  { value: 'justice', label: 'Uplift Justice' },
  { value: 'community', label: 'Uplift Community' },
];

function NewPostForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [type, setType] = useState<PostType>((searchParams.get('type') as PostType) ?? 'story');
  const [module, setModule] = useState<UpliftModule | ''>((searchParams.get('module') as UpliftModule) ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
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
    const { error } = await (supabase as any).from('posts').insert({
      author_id: user.id,
      type,
      module: module || null,
      title,
      body,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      status: 'active',
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      toast.success('Post published successfully!');
      router.push('/network');
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link href="/network" className="text-sm text-white/40 hover:text-white flex items-center gap-1 transition-colors">
            &larr; Back to network
          </Link>
          <h1 className="text-3xl font-bold text-white mt-4">Share with the community</h1>
          <p className="text-white/50 mt-1">Your voice matters here.</p>
        </div>

        <div className="glass-card p-8">
          {error && <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/30 text-red-400 border border-red-800">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-white mb-2">Post type</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {POST_TYPES.map(pt => (
                  <button type="button" key={pt.value}
                    onClick={() => setType(pt.value)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium text-left transition-colors border ${
                      type === pt.value
                        ? 'bg-[#22c55e] text-[#0a0a0a] border-[#22c55e]'
                        : 'bg-white/5 text-white/70 border-white/10 hover:border-[#22c55e]/50'
                    }`}>
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="title">Title <span className="text-red-500">*</span></label>
              <input id="title" type="text" required value={title} onChange={e => setTitle(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="What do you want to share?" />
            </div>

            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="body">Details</label>
              <textarea id="body" rows={5} value={body} onChange={e => setBody(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30 resize-none"
                placeholder="Tell your story, describe what you need, or share more context..." />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="module">Module (optional)</label>
                <select id="module" value={module} onChange={e => setModule(e.target.value as UpliftModule | '')}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white">
                  <option value="">All modules</option>
                  {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="tags">Tags (optional)</label>
                <input id="tags" type="text" value={tags} onChange={e => setTags(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="rent, childcare, food" />
                <p className="text-xs text-white/30 mt-1">Comma-separated</p>
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors disabled:opacity-50 shadow-lg shadow-red-900/20">
              {loading ? 'Posting...' : 'Post to network'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function NewPostPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-white/40">Loading...</p>
      </div>
    }>
      <NewPostForm />
    </Suspense>
  );
}
