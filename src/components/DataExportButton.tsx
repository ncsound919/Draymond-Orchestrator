'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

type ExportFormat = 'csv' | 'json';

interface DataExportButtonProps {
  /** Human-readable label, e.g. "Agents" */
  label: string;
  /** The data to export — array of flat objects */
  data: Record<string, unknown>[];
  /** Optional filename prefix (default: label lowercased) */
  filenamePrefix?: string;
}

function toCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return '';
  const keys = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // CSV injection defence: prefix dangerous leading chars with a single quote FIRST,
    // then check for quoting — order matters: quoting alone doesn't stop formula injection
    // because Excel evaluates the formula before treating the cell as text.
    if (/^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = keys.join(',');
  const rows = records.map((r) => keys.map((k) => escape(r[k])).join(','));
  return [header, ...rows].join('\n');
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke to give browsers time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function DataExportButton({ label, data, filenamePrefix }: DataExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Use filenamePrefix if provided; otherwise derive from label with a final fallback of
  // 'export' to prevent an underscore-only filename when label is empty.
  const prefix = filenamePrefix ?? (label || 'export').toLowerCase().replace(/\s+/g, '-');

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (data.length === 0) return;
      const ts = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        download(toCsv(data), `${prefix}_${ts}.csv`, 'text/csv');
      } else {
        download(JSON.stringify(data, null, 2), `${prefix}_${ts}.json`, 'application/json');
      }
      setOpen(false);
    },
    [data, prefix],
  );

  if (data.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-gray-800/60 px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:text-white hover:border-white/[0.15] transition-colors"
        title={`Export ${label}`}
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Export
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-36 rounded-lg border border-white/[0.08] bg-gray-900 shadow-xl">
          <button
            onClick={() => handleExport('csv')}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-white/[0.05] hover:text-white transition-colors rounded-t-lg"
          >
            Download CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-white/[0.05] hover:text-white transition-colors rounded-b-lg"
          >
            Download JSON
          </button>
        </div>
      )}
    </div>
  );
}
