'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';

const modules = [
  { name: 'Learn', href: '/modules/learn' },
  { name: 'Health', href: '/modules/health' },
  { name: 'Wealth', href: '/modules/wealth' },
  { name: 'Ventures', href: '/modules/ventures' },
  { name: 'Justice', href: '/modules/justice' },
  { name: 'Community', href: '/modules/community' },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <Image
              src="/logo-mark.svg"
              alt="The Uplift Lab"
              width={36}
              height={36}
              className="flex-shrink-0"
              priority
            />
            <span className="font-bold text-lg tracking-tight hidden sm:block text-white">
              The Uplift <span className="text-[#dc2626]">Lab</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Primary navigation">
            {modules.map((m) => (
              <Link key={m.name} href={m.href}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors">
                {m.name}
              </Link>
            ))}
            <Link href="/network"
              className="ml-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-[#22c55e] hover:text-[#4ade80] hover:bg-white/5 transition-colors">
              Network
            </Link>
          </nav>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-2">
            {user ? (
              <>
                <Link href="/network/new"
                  className="px-3 py-1.5 text-sm font-medium text-white/60 hover:text-white transition-colors">
                  + Post
                </Link>
                <button onClick={handleSignOut}
                  className="px-4 py-1.5 text-sm font-medium rounded-full border border-white/10 text-white/60 hover:bg-white/5 hover:text-white transition-colors">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/login"
                  className="px-4 py-1.5 text-sm font-medium text-white/60 hover:text-white transition-colors">
                  Sign in
                </Link>
                <Link href="/auth/signup"
                  className="px-4 py-1.5 text-sm font-semibold rounded-full bg-[#dc2626] text-white hover:bg-[#ef4444] transition-colors shadow-lg shadow-red-900/20">
                  Join free
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-lg text-white/60 hover:bg-white/5 transition-colors"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <span aria-hidden="true">{menuOpen ? '\u00D7' : '\u2630'}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden glass border-t border-white/5 px-4 pb-4">
          <nav className="flex flex-col gap-1 pt-3" aria-label="Mobile navigation">
            {modules.map((m) => (
              <Link key={m.name} href={m.href}
                className="px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white transition-colors"
                onClick={() => setMenuOpen(false)}>
                {m.name}
              </Link>
            ))}
            <Link href="/network"
              className="px-3 py-2 rounded-lg text-sm font-semibold text-[#22c55e] hover:bg-white/5 transition-colors"
              onClick={() => setMenuOpen(false)}>
              Network
            </Link>
            <div className="mt-2 pt-2 border-t border-white/5 flex flex-col gap-1">
              {user ? (
                <>
                  <Link href="/network/new" className="px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5" onClick={() => setMenuOpen(false)}>+ Post</Link>
                  <button onClick={() => { handleSignOut(); setMenuOpen(false); }} className="px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5 text-left">Sign out</button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" className="px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/5" onClick={() => setMenuOpen(false)}>Sign in</Link>
                  <Link href="/auth/signup" className="px-3 py-2 rounded-lg text-sm font-semibold text-[#dc2626] hover:bg-white/5" onClick={() => setMenuOpen(false)}>Join free</Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
