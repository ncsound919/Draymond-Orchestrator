'use client';

// ============================================================================
// ChatLayout — sidebar + chat column shell
// ============================================================================
// Wraps the chat pages. The conversation sidebar is collapsible (floating
// toggle on small screens, inline on large screens). Children render in the
// chat column and fill the available height.
// ============================================================================

import { useEffect, useState, type ReactNode } from 'react';
import ConversationSidebar from './ConversationSidebar';

export default function ChatLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      setIsDesktop(mq.matches);
      if (mq.matches) setOpen(true);
      else setOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return (
    <div className="relative mx-auto flex h-[calc(100vh-6rem)] max-w-[1440px] gap-3 px-3 py-3 sm:px-4">
      {/* Sidebar */}
      <div
        className={`${
          open ? 'flex' : 'hidden'
        } ${isDesktop ? 'relative' : 'absolute inset-y-3 left-3 z-30'}`}
      >
        <ConversationSidebar />
      </div>

      {/* Mobile overlay backdrop */}
      {!isDesktop && open && (
        <button
          className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      {/* Chat column */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/5 bg-black/20">
        {children}
      </div>

      {/* Sidebar toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute left-3 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/60 text-gray-300 backdrop-blur-xl transition-colors hover:bg-white/10 hover:text-white"
        aria-label={open ? 'Hide conversations' : 'Show conversations'}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          {open ? <path d="M9 18 15 12 9 6" /> : <path d="M15 18 9 12 15 6" />}
        </svg>
      </button>
    </div>
  );
}
