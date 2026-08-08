/**
 * PyodideErrorBoundary — surfaces WASM/worker failures without crashing the
 * Math Lab. Ported from @mathx/web.
 */
'use client';

import { Component } from 'react';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  message: string;
}

export class PyodideErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'var(--bg2)',
            border: '1px solid #7a1f1f',
            color: '#e8b4b4',
            fontSize: '0.8rem',
          }}
        >
          <strong>Pyodide error</strong>
          <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>{this.state.message}</div>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            style={{
              marginTop: 8,
              background: 'transparent',
              border: '1px solid var(--border-bright)',
              color: 'var(--text)',
              borderRadius: 4,
              padding: '3px 10px',
              cursor: 'pointer',
              fontSize: '0.7rem',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
