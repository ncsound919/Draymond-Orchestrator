'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { Profile, UpliftModule } from '@/lib/supabase/types';

const MODULES: { value: UpliftModule; label: string }[] = [
  { value: 'learn', label: 'Uplift Learn' },
  { value: 'health', label: 'Uplift Health' },
  { value: 'wealth', label: 'Uplift Wealth' },
  { value: 'ventures', label: 'Uplift Ventures' },
  { value: 'justice', label: 'Uplift Justice' },
  { value: 'community', label: 'Uplift Community' },
];

export default function EditProfilePage() {
  const router = useRouter();
  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [shortBio, setShortBio] = useState('');
  const [locationCity, setLocationCity] = useState('');
  const [locationState, setLocationState] = useState('');
  const [selectedModules, setSelectedModules] = useState<UpliftModule[]>([]);

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        setError('Could not load your profile.');
        setLoading(false);
        return;
      }

      const profile = data as Profile;
      setProfile(profile);
      setDisplayName(profile.display_name ?? '');
      setShortBio(profile.short_bio ?? '');
      setLocationCity(profile.location_city ?? '');
      setLocationState(profile.location_state ?? '');
      setSelectedModules(profile.modules ?? []);
      setLoading(false);
    }
    loadProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is stable via useRef, router is stable in Next.js
  }, []);

  function toggleModule(mod: UpliftModule) {
    setSelectedModules((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase SSR/client type mismatch
    const { error } = await (supabase as any)
      .from('profiles')
      .update({
        display_name: displayName || null,
        short_bio: shortBio || null,
        location_city: locationCity || null,
        location_state: locationState || null,
        modules: selectedModules,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile!.id);

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
      setTimeout(() => {
        router.push(`/profile/${profile!.username}`);
      }, 1200);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <p className="text-white/40">Loading profile…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-white/40 mb-4">Profile not found.</p>
          <Link href="/" className="text-[#22c55e] font-medium hover:underline">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link
            href={`/profile/${profile.username}`}
            className="text-sm text-white/40 hover:text-white flex items-center gap-1 transition-colors"
          >
            &larr; Back to profile
          </Link>
          <h1 className="text-3xl font-bold text-white mt-4">Edit Profile</h1>
          <p className="text-white/50 mt-1">
            Update your information. Your username (<strong className="text-white/70">@{profile.username}</strong>) cannot be changed.
          </p>
        </div>

        <div className="glass-card p-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/30 text-red-400 border border-red-800">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-green-900/30 text-green-400 border border-green-800">
              Profile updated! Redirecting…
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Display Name */}
            <div>
              <label
                className="block text-sm font-medium text-white mb-1.5"
                htmlFor="displayName"
              >
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="Your display name"
              />
            </div>

            {/* Short Bio */}
            <div>
              <label
                className="block text-sm font-medium text-white mb-1.5"
                htmlFor="bio"
              >
                Short Bio
              </label>
              <textarea
                id="bio"
                rows={3}
                value={shortBio}
                onChange={(e) => setShortBio(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30 resize-none"
                placeholder="Tell the community about yourself"
              />
            </div>

            {/* Location */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm font-medium text-white mb-1.5"
                  htmlFor="city"
                >
                  City
                </label>
                <input
                  id="city"
                  type="text"
                  value={locationCity}
                  onChange={(e) => setLocationCity(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="e.g. Atlanta"
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium text-white mb-1.5"
                  htmlFor="state"
                >
                  State
                </label>
                <input
                  id="state"
                  type="text"
                  value={locationState}
                  onChange={(e) => setLocationState(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="e.g. GA"
                />
              </div>
            </div>

            {/* Module Interests */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Module Interests
              </label>
              <p className="text-xs text-white/40 mb-3">
                Select the modules you&apos;re most interested in.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MODULES.map((mod) => (
                  <button
                    key={mod.value}
                    type="button"
                    onClick={() => toggleModule(mod.value)}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium text-left transition-colors border ${
                      selectedModules.includes(mod.value)
                        ? 'bg-[#22c55e] text-[#0a0a0a] border-[#22c55e]'
                        : 'bg-white/5 text-white/70 border-white/10 hover:border-[#22c55e]/50'
                    }`}
                  >
                    {mod.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors disabled:opacity-50 shadow-lg shadow-red-900/20"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
