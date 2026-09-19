'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useOrchestratorHealth } from '@/hooks/useOrchestratorHealth';

const navItems = [
  { name: 'Command Center', href: '/command-center' },
  { name: 'Chat', href: '/chat' },
  { name: 'IDE', href: '/ide' },
  { name: 'Math', href: '/math' },
  { name: 'Operations', href: '/operations' },
  { name: 'Strategy', href: '/strategy' },
  { name: 'Mission', href: '/mission' },
  { name: 'Cognition', href: '/cognition' },
  { name: 'Agents', href: '/agents' },
  { name: 'Workflows', href: '/workflows' },
  { name: 'Schedules', href: '/schedules' },
  { name: 'Approvals', href: '/approvals' },
  { name: 'Downloads', href: '/downloads' },
  { name: 'Admin', href: '/admin' },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  // Real liveness signal — never a hardcoded green dot.
  const status = useOrchestratorHealth();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on navigation.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  async function logout() {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) console.warn(`[header] logout returned ${res.status}`);
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <header className="glass-header sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#22c55e]/20 text-[#22c55e] font-bold text-sm">
              D
            </span>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:block">
              Draymond <span className="text-white/40 font-normal">Orchestrator</span>
            </span>
          </Link>

          {/* Nav links (desktop) */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Primary navigation">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-white/50 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 p-2 text-white/70 hover:text-white"
          >
            <span aria-hidden="true" className="text-base leading-none">{menuOpen ? '✕' : '☰'}</span>
          </button>

          {/* Status indicator + logout */}
          <div className="flex items-center gap-3">
            <span
              role="status"
              title={
                status === 'online'
                  ? 'Orchestrator reachable'
                  : status === 'offline'
                    ? 'Orchestrator unreachable'
                    : 'Checking orchestrator…'
              }
              className={`inline-block w-2 h-2 rounded-full ${
                status === 'online'
                  ? 'bg-green-500 animate-pulse'
                  : status === 'offline'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
              }`}
            />
            <span className="text-xs text-white/60 hidden sm:block">
              {status === 'online' ? 'System Online' : status === 'offline' ? 'System Unreachable' : 'Checking…'}
            </span>
            {pathname !== '/login' && (
              <button
                type="button"
                onClick={logout}
                className="text-xs font-medium text-white/50 hover:text-white transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav panel */}
        {menuOpen && (
          <nav
            id="mobile-nav"
            aria-label="Primary navigation"
            className="md:hidden border-t border-white/10 py-2 grid grid-cols-2 gap-1"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${
                    isActive ? 'text-white bg-white/10' : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
