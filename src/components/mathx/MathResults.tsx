/**
 * MathResults — renders the Math Lab message list: math-rendered text,
 * code execution output, charts (ECharts, lazy), and tables.
 */
'use client';

import dynamic from 'next/dynamic';
import { MathRenderer } from './MathRenderer';
import { ParameterSliders } from './ParameterSliders';

const ChartView = dynamic(() => import('./ChartView').then((m) => m.ChartView), {
  ssr: false,
  loading: () => <div style={{ padding: 12, fontSize: '0.7rem', color: 'var(--text-muted)' }}>Loading chart…</div>,
});

export interface MathExecution {
  stdout?: string;
  chart?: { data?: unknown[]; layout?: unknown };
  table?: { columns?: string[]; rows?: unknown[][] };
  code?: string;
  error?: string;
}

export interface MathLabMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  execution?: MathExecution;
  streaming?: boolean;
}

interface MathResultsProps {
  messages: MathLabMessage[];
  loading: boolean;
  accent: string;
  onRunParams: (code: string, params: Record<string, number>) => void;
}

function renderExecution(execution: MathExecution, accent: string, onRunParams: MathResultsProps['onRunParams']) {
  return (
    <div style={{ marginTop: 10 }}>
      {execution.error && (
        <pre style={{ background: 'var(--bg4)', padding: 10, borderRadius: 6, fontSize: '0.72rem', color: '#e8b4b4', overflowX: 'auto' }}>{execution.error}</pre>
      )}
      {execution.stdout && (
        <pre style={{ background: 'var(--bg4)', padding: 10, borderRadius: 6, fontSize: '0.72rem', color: 'var(--text)', overflowX: 'auto', margin: 0 }}>{execution.stdout}</pre>
      )}
      {execution.chart && (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <ChartView data={execution.chart as any} />
      )}
      {execution.table && Array.isArray(execution.table.columns) && (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.72rem', marginTop: 8 }}>
          <thead>
            <tr>
              {execution.table.columns.map((c) => (
                <th key={c} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--border)', color: accent }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(execution.table.rows ?? []).map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-dim)', fontFamily: 'var(--font-mono)' }}>
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {execution.code && (
        <ParameterSliders key={execution.code} code={execution.code} onParamsChange={(p) => onRunParams(execution.code!, p)} accent={accent} />
      )}
    </div>
  );
}

export function MathResults({ messages, loading, accent, onRunParams }: MathResultsProps) {
  if (messages.length === 0) {
    return (
      <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        Ask a question — Probability, Deep Solve, Hypothesis, or cross-domain Synergy.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px' }}>
      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '86%',
            background: m.role === 'user' ? 'var(--bg3)' : 'var(--bg2)',
            border: `1px solid ${m.role === 'user' ? accent + '44' : 'var(--border-dim)'}`,
            borderRadius: 10,
            padding: '10px 14px',
          }}
        >
          {m.role === 'user' ? (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem' }}>{m.content}</div>
          ) : (
            <>
              <MathRenderer text={m.content} accent={accent} />
              {m.execution && renderExecution(m.execution, accent, onRunParams)}
            </>
          )}
        </div>
      ))}
      {loading && (
        <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.1em' }}>
          {loading ? 'WORKING…' : ''}
        </div>
      )}
    </div>
  );
}
