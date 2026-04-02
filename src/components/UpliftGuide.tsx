'use client';
import { useState, useRef, useEffect } from 'react';
import { useChat } from 'ai/react';

interface Message { id: string; role: 'user' | 'assistant'; content: string; }

export default function UpliftGuide() {
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/chat',
    initialMessages: [
      {
        id: 'welcome',
        role: 'assistant',
        content: "Hello! I'm your Uplift Guide. I can help you navigate resources across education, health, wealth, ventures, justice, and community. What can I help you with today?",
      },
    ],
  });

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  return (
    <>
      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close Uplift Guide' : 'Open Uplift Guide'}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-[#dc2626] text-white shadow-lg shadow-red-900/30 hover:bg-[#ef4444] transition-colors flex items-center justify-center text-2xl focus:outline-none focus:ring-2 focus:ring-[#22c55e] focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
      >
        {open ? '\u00D7' : '\u2728'}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Uplift Guide chat"
          className="fixed bottom-24 right-6 z-50 w-[340px] max-w-[calc(100vw-3rem)] glass rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: '480px' }}
        >
          {/* Header */}
          <div className="bg-[#111111] border-b border-white/5 px-4 py-3 flex items-center gap-2">
            <span className="text-xl">\u2728</span>
            <div>
              <p className="text-white font-semibold text-sm">Uplift Guide</p>
              <p className="text-white/40 text-xs">Your community AI ally</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#0a0a0a]" style={{ minHeight: 0 }}>
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#dc2626] text-white rounded-br-sm'
                    : 'bg-white/5 text-white/80 rounded-bl-sm border border-white/5'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/5 px-3 py-2 rounded-2xl rounded-bl-sm">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-[#22c55e]/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#22c55e]/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-[#22c55e]/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            {error && (
              <div className="text-xs text-red-400 text-center">
                {error.message.includes('503') ? 'Add OPENAI_API_KEY to enable AI.' : 'Something went wrong. Try again.'}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-white/5 bg-[#111111] flex gap-2">
            <input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask me anything..."
              className="flex-1 px-3 py-2 text-sm rounded-full border border-white/10 bg-white/5 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#22c55e]"
              aria-label="Message to Uplift Guide"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="w-9 h-9 bg-[#22c55e] text-[#0a0a0a] rounded-full flex items-center justify-center font-bold text-lg hover:bg-[#4ade80] transition-colors disabled:opacity-40"
              aria-label="Send message"
            >
              &#8593;
            </button>
          </form>
        </div>
      )}
    </>
  );
}
