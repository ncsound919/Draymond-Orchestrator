'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-green-900/30 border border-green-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-[#22c55e]">&#10003;</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-white/50 mb-6">We sent a confirmation link to <strong className="text-white">{email}</strong>. Click it to activate your account.</p>
          <Link href="/auth/login" className="text-[#22c55e] font-medium hover:underline">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <Image src="/logo-mark.svg" alt="The Uplift Lab" width={40} height={40} />
            <span className="text-white font-bold text-xl">The Uplift Lab</span>
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">Join the community</h1>
          <p className="text-white/50">Create your free Uplift Lab account</p>
        </div>

        <div className="glass-card p-8">
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/30 text-red-400 border border-red-800">{error}</div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="displayName">Display Name</label>
                <input id="displayName" type="text" required value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="Maya Johnson" />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1.5" htmlFor="username">Username</label>
                <input id="username" type="text" required value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                  placeholder="mayaj" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="email">Email</label>
              <input id="email" type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="you@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="password">Password</label>
              <input id="password" type="password" required minLength={8} value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="Min. 8 characters" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors disabled:opacity-50 shadow-lg shadow-red-900/20">
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-white/50">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-[#22c55e] font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
