'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    } else {
      router.push('/network');
    }
    setLoading(false);
  }

  async function handleMagicLink() {
    if (!email) { setError('Enter your email first.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
    if (error) setError(error.message);
    else setError('Check your email for a magic link!');
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <Image src="/logo-mark.svg" alt="The Uplift Lab" width={40} height={40} />
            <span className="text-white font-bold text-xl">The Uplift Lab</span>
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome back</h1>
          <p className="text-white/50">Sign in to your Uplift Lab account</p>
        </div>

        <div className="glass-card p-8">
          {error && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${error.includes('Check your email') ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="email">Email</label>
              <input
                id="email" type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-1.5" htmlFor="password">Password</label>
              <input
                id="password" type="password" required value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-[#22c55e] bg-white/5 text-white placeholder-white/30"
                placeholder="••••••••"
              />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-[#dc2626] text-white font-semibold rounded-full hover:bg-[#ef4444] transition-colors disabled:opacity-50 shadow-lg shadow-red-900/20">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-sm text-white/30">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button onClick={handleMagicLink} disabled={loading}
            className="mt-4 w-full py-3 border border-white/10 bg-white/5 text-white font-medium rounded-full hover:bg-white/10 transition-colors disabled:opacity-50">
            Send magic link
          </button>

          <p className="mt-6 text-center text-sm text-white/50">
            No account?{' '}
            <Link href="/auth/signup" className="text-[#22c55e] font-medium hover:underline">Sign up free</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
