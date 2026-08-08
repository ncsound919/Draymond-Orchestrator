/**
 * Math Lab — the embedded Math X workspace: mode rail, input, and the
 * plan → codegen → compute (Pyodide) → narrative pipeline against /api/math/*.
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import { usePyodide } from '@/workers/usePyodide';
import { PyodideErrorBoundary } from '@/components/mathx/PyodideErrorBoundary';
import { MathResults } from '@/components/mathx/MathResults';
import type { MathExecution, MathLabMessage } from '@/components/mathx/MathResults';

const MODES = [
  { id: 'scientist', icon: '◈', label: 'Scientist', color: 'var(--gold)' },
  { id: 'formula', icon: '∿', label: 'Formula Lab', color: 'var(--teal)' },
  { id: 'hypothesis', icon: '⬡', label: 'Hypothesis', color: 'var(--purple)' },
  { id: 'solve', icon: '∂', label: 'Deep Solve', color: 'var(--blue)' },
  { id: 'synergy', icon: '⊗', label: 'Synergy', color: 'var(--orange)' },
  { id: 'probability', icon: '🎲', label: 'Probability', color: 'var(--purple)' },
  { id: 'files', icon: '◫', label: 'File Intel', color: 'var(--green)' },
  { id: 'domain', icon: '∫', label: 'Domain Expert', color: 'var(--purple)' },
];

let idCounter = 0;
const nextId = () => `m-${++idCounter}-${Date.now()}`;

export default function MathLabPage() {
  const { ready: pyReady, compute, loadExtra, status } = usePyodide();
  const [activeMode, setActiveMode] = useState('scientist');
  const [messages, setMessages] = useState<MathLabMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mode = MODES.find((m) => m.id === activeMode) ?? MODES[0];

  const runCode = useCallback(
    async (code: string): Promise<string> => {
      // Lazy-load pandas/statsmodels when the generated code needs them.
      // numpy/scipy/sympy are in the worker's base package set.
      if (code.includes('pandas') && !status.extraPackages.includes('pandas')) {
        await loadExtra(['pandas']).catch(() => {});
      }
      if (code.includes('statsmodels') && !status.extraPackages.includes('statsmodels')) {
        await loadExtra(['statsmodels']).catch(() => {});
      }
      return compute(code);
    },
    [compute, loadExtra, status.extraPackages],
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || loading) return;
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: text },
      ];
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }]);
      setLoading(true);
      setError(null);
      try {
        const planRes = await fetch('/api/math/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text, mode: activeMode, hasFiles: false }),
        });
        const planData = (await planRes.json()) as {
          plan?: { requires_code?: boolean; engine?: string };
        };
        const plan = planData.plan ?? { requires_code: false, engine: activeMode };

        let execution: MathExecution | undefined;
        if (plan.requires_code && pyReady) {
          const codeRes = await fetch('/api/math/codegen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: text, mode: plan.engine ?? activeMode }),
          });
          const { code } = (await codeRes.json()) as { code?: string };
          if (code) {
            const stdout = await runCode(code);
            let parsed: { chart?: MathExecution['chart']; table?: MathExecution['table'] } | null = null;
            try {
              parsed = JSON.parse(stdout);
            } catch {
              parsed = null;
            }
            execution = {
              stdout,
              chart: parsed?.chart,
              table: parsed?.table,
              code,
            };
          }
        }

        const chatRes = await fetch('/api/math/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history,
            mode: activeMode,
            execution: execution ? { stdout: execution.stdout, error: execution.error } : undefined,
          }),
        });
        const chatData = (await chatRes.json()) as { text?: string; error?: string };
        if (!chatRes.ok) throw new Error(chatData.error ?? `Chat failed (${chatRes.status})`);

        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: chatData.text ?? '', execution },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `⚠ Error: ${err instanceof Error ? err.message : String(err)}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, activeMode, pyReady, runCode],
  );

  const onRunParams = useCallback(
    async (code: string, params: Record<string, number>) => {
      let next = code;
      for (const [name, value] of Object.entries(params)) {
        next = next.replace(new RegExp(`^(${name}\\s*=\\s*)[^\\n]+`, 'm'), `$1${value}`);
      }
      setLoading(true);
      try {
        const stdout = await runCode(next);
        setMessages((prev) => {
          const out = [...prev];
          for (let i = out.length - 1; i >= 0; i--) {
            if (out[i].execution) {
              out[i] = { ...out[i], execution: { ...out[i].execution!, stdout, code: next } };
              break;
            }
          }
          return out;
        });
      } finally {
        setLoading(false);
      }
    },
    [runCode],
  );

  const handleOcr = useCallback(async (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result).split(',')[1] ?? '';
      try {
        const res = await fetch('/api/math/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data, mediaType: file.type || 'image/png' }),
        });
        const { latex, error: ocrError } = (await res.json()) as { latex?: string; error?: string };
        if (!res.ok || !latex) throw new Error(ocrError ?? 'OCR failed');
        const input = inputRef.current;
        if (input) {
          input.value = (input.value ? input.value + ' ' : '') + latex;
          input.focus();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsDataURL(file);
  }, []);

  return (
    <>
      <style>{`
        .math-lab{ --gold:#c8a415; --teal:#2dd4bf; --purple:#a78bfa; --blue:#60a5fa;
          --orange:#fb923c; --green:#22c55e; --bg2:#141414; --bg3:#1c1c1c; --bg4:#232323;
          --text:#e5e7eb; --text-muted:#9ca3af; --text-dim:#6b7280;
          --border:#3a3a3a; --border-dim:#2a2a2a; --border-bright:#555; --font-mono:ui-monospace,monospace; }
      `}</style>
      <PyodideErrorBoundary>
        <div className="math-lab" style={{ minHeight: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
          {/* Mode rail */}
          <div style={{ display: 'flex', overflowX: 'auto', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-dim)', background: '#111' }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveMode(m.id)}
                title={m.label}
                style={{
                  padding: '7px 14px', border: 'none', cursor: 'pointer', borderRadius: 6,
                  background: activeMode === m.id ? m.color + '22' : 'transparent',
                  color: activeMode === m.id ? m.color : 'var(--text-muted)',
                  borderBottom: activeMode === m.id ? `2px solid ${m.color}` : '2px solid transparent',
                  fontSize: '0.72rem', whiteSpace: 'nowrap',
                }}
              >
                <span style={{ marginRight: 4 }}>{m.icon}</span>{m.label}
              </button>
            ))}
            <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: '0.6rem', color: pyReady ? 'var(--green)' : 'var(--text-muted)', letterSpacing: '0.1em' }}>
              WASM {pyReady ? 'READY' : 'BOOTING'}
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <MathResults messages={messages} loading={loading} accent={mode.color} onRunParams={onRunParams} />
          </div>

          {/* Error strip */}
          {error && (
            <div style={{ padding: '6px 14px', fontSize: '0.72rem', color: '#e8b4b4', background: '#2a1212' }}>
              {error}
              <button onClick={() => setError(null)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
            </div>
          )}

          {/* Input */}
          <div style={{ padding: 12, borderTop: '1px solid var(--border-dim)', background: '#111' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => fileRef.current?.click()}
                title="Drop an image to OCR it into LaTeX"
                style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer', padding: '0 12px', fontSize: '0.8rem' }}
              >
                🖼
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleOcr(f);
                  e.target.value = '';
                }}
              />
              <textarea
                ref={inputRef}
                rows={2}
                placeholder={`Ask in ${mode.label} mode…  (e.g. "estimate P(flood > 2m) with a Monte Carlo")`}
                style={{
                  flex: 1, resize: 'none', background: 'var(--bg2)', border: '1px solid var(--border)',
                  color: 'var(--text)', borderRadius: 6, padding: '10px 12px', fontSize: '0.85rem', outline: 'none',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const el = e.currentTarget;
                    void send(el.value);
                    el.value = '';
                  }
                }}
              />
              <button
                onClick={() => {
                  const el = inputRef.current;
                  if (el) {
                    void send(el.value);
                    el.value = '';
                  }
                }}
                disabled={loading}
                style={{
                  background: mode.color, border: 'none', borderRadius: 6, color: '#0a0a0a',
                  padding: '0 20px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', opacity: loading ? 0.5 : 1,
                }}
              >
                SEND
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
              Enter ⏎ to run · Shift+Enter for a new line · 🖼 OCR images into LaTeX
            </div>
          </div>
        </div>
      </PyodideErrorBoundary>
    </>
  );
}
