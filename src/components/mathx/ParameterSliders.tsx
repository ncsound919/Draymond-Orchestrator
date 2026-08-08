/**
 * ParameterSliders — detects `NAME = number` lines in generated Python and lets
 * the user re-run compute with tweaked values. Ported from @mathx/web.
 */
'use client';

import { useState, useMemo, useCallback } from 'react';

interface SliderVar {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}

interface ParameterSlidersProps {
  code: string;
  onParamsChange: (params: Record<string, number>) => void;
  accent: string;
  running?: boolean;
}

const SKIP = new Set(['import', 'from', 'as', 'pi', 'e', 'true', 'false', 'none', 'return', 'def', 'class', 'if', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'print']);

function inferRange(name: string, value: number): { min: number; max: number; step: number } {
  const lname = name.toLowerCase();
  if (/^(n|num|count|k|iter|steps?)$/.test(lname)) {
    return { min: Math.max(1, Math.floor(value * 0.2)), max: Math.max(value * 5, value + 50), step: 1 };
  }
  if (/^(omega|freq|f|hz|w)$/.test(lname)) {
    return { min: 0.1, max: Math.max(value * 10, 20), step: 0.1 };
  }
  if (/^(p|prob|rate|alpha|beta|gamma|lambda)$/.test(lname)) {
    return { min: 0.01, max: 1, step: 0.01 };
  }
  const absVal = Math.abs(value) || 1;
  return {
    min: Math.round(value - absVal * 5),
    max: Math.round(value + absVal * 5),
    step: parseFloat((absVal * 0.05).toPrecision(1)),
  };
}

/** Parse `NAME = number` lines from generated code into slider descriptors. */
function parseCode(code: string): SliderVar[] {
  const pattern = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/gm;
  const found: SliderVar[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const name = match[1];
    const value = parseFloat(match[2]);
    if (SKIP.has(name.toLowerCase()) || seen.has(name) || isNaN(value)) continue;
    seen.add(name);
    const { min, max, step } = inferRange(name, value);
    found.push({ name, value, min, max, step });
  }
  return found.slice(0, 8);
}

export function ParameterSliders({ code, onParamsChange, accent, running = false }: ParameterSlidersProps) {
  // Derived via useMemo; the parent keys this component by `code` so values
  // reset on a code change without a setState-in-effect.
  const sliders = useMemo(() => parseCode(code), [code]);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(parseCode(code).map((s) => [s.name, s.value])),
  );

  const handleChange = useCallback((name: string, raw: string) => {
    const value = parseFloat(raw);
    const next = { ...values, [name]: value };
    setValues(next);
    onParamsChange(next);
  }, [values, onParamsChange]);

  if (sliders.length === 0) return null;

  return (
    <div style={{
      marginTop: 10,
      padding: '10px 14px',
      background: 'var(--bg2)',
      border: `1px solid ${accent}33`,
      borderRadius: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: '0.6rem', color: accent, letterSpacing: '0.12em' }}>PARAMETERS</span>
        {running && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>RUNNING…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px 16px' }}>
        {sliders.map((s) => {
          const current = values[s.name] ?? s.value;
          return (
            <div key={s.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <label style={{ fontSize: '0.62rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{s.name}</label>
                <span style={{ fontSize: '0.62rem', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                  {Number.isInteger(s.step) ? Math.round(current) : current.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={current}
                onChange={(e) => handleChange(s.name, e.target.value)}
                style={{ width: '100%', accentColor: accent, height: 4, cursor: 'pointer' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
