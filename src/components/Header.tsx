'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { name: 'Operations', href: '/operations' },
  { name: 'Agents', href: '/agents' },
  { name: 'Workflows', href: '/workflows' },
  { name: 'Schedules', href: '/schedules' },
  { name: 'Approvals', href: '/approvals' },
  { name: 'Pipeline', href: '/pipeline' },
  { name: 'Downloads', href: '/downloads' },
  { name: 'Admin', href: '/admin' },
];

export default function Header() {
  const pathname = usePathname();

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

          {/* Nav links */}
          <nav className="flex items-center gap-1" aria-label="Primary navigation">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.name}
                  href={item.href}
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

          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-white/40 hidden sm:block">System Online</span>
          </div>
        </div>
      </div>
    </header>
  );
}
