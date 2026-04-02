'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHotkeys } from 'react-hotkeys-hook';

const shortcuts = [
  { keys: '?', description: 'Toggle this help panel' },
  { keys: 'g h', description: 'Go home' },
  { keys: 'g n', description: 'Go to network' },
  { keys: 'g m', description: 'Go to modules' },
  { keys: 'g s', description: 'Go to search' },
  { keys: '/', description: 'Focus search' },
  { keys: 'Esc', description: 'Close panel' },
];

export default function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  useHotkeys('shift+/', (e) => {
    e.preventDefault();
    setIsOpen((prev) => !prev);
  });

  useHotkeys('g+h', () => router.push('/'), { preventDefault: true });
  useHotkeys('g+n', () => router.push('/network'), { preventDefault: true });
  useHotkeys('g+m', () => router.push('/modules'), { preventDefault: true });
  useHotkeys('g+s', () => router.push('/search'), { preventDefault: true });

  useHotkeys('/', (e) => {
    e.preventDefault();
    const input = document.querySelector<HTMLInputElement>('input[name="q"]');
    input?.focus();
  });

  useHotkeys('escape', () => setIsOpen(false));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={() => setIsOpen(false)}
            className="text-white/40 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close shortcuts panel"
          >
            &times;
          </button>
        </div>
        <div className="space-y-2">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-white/60">{s.description}</span>
              <kbd className="px-2 py-0.5 rounded bg-white/10 text-xs font-mono text-white/80 border border-white/10">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-white/30 text-center">
          Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/60 border border-white/10 font-mono">?</kbd> to toggle
        </p>
      </div>
    </div>
  );
}
