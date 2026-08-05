'use client';
/**
 * FolderImportWizard
 *
 * Lets users drag-and-drop or browse a local agent/system folder.
 * Uses showDirectoryPicker() (File System Access API) with a
 * webkitdirectory <input> fallback for Safari/Firefox.
 *
 * On confirmation, sends the parsed FileMap to POST /api/registry/import.
 */
import { useState, useRef, useCallback } from 'react';

interface ImportResult {
  ok: boolean;
  agent?: { id: string; slug: string; name: string };
  workflowsImported?: number;
  error?: string;
}

type WizardStep = 'idle' | 'reading' | 'preview' | 'importing' | 'done' | 'error';

interface FilePreview {
  folderName: string;
  files: Record<string, string>;
  fileList: string[];
  hasManifest: boolean;
  detectedRuntime: string;
  agentName?: string;
}

function detectRuntime(files: Record<string, string>): string {
  const keys = Object.keys(files).map((k) => k.toLowerCase());
  if (keys.some((k) => k.endsWith('mcp.json'))) return 'MCP';
  if (keys.some((k) => k.endsWith('acp.json'))) return 'ACP';
  if (keys.some((k) => k.endsWith('cli.json'))) return 'CLI';
  return 'HTTP';
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    // For images: read as base64 data URL
    const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
    if (isImage) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

export default function FolderImportWizard({ onImported }: { onImported?: () => void }) {
  const [step, setStep] = useState<WizardStep>('idle');
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (
    rawFiles: File[],
    folderName: string,
  ) => {
    setStep('reading');
    const files: Record<string, string> = {};
    for (const file of rawFiles) {
      const rel = (file.webkitRelativePath || file.name).replace(/^[^/]+\//, '');
      if (!rel) continue;
      try {
        files[rel] = await readFileAsText(file);
      } catch {
        // Skip unreadable files silently
      }
    }

    const manifestRaw = files['agent.json'] ?? files['Agent.json'];
    let agentName: string | undefined;
    if (manifestRaw) {
      try { agentName = (JSON.parse(manifestRaw) as { name?: string }).name; }
      catch { /* ignore */ }
    }

    setPreview({
      folderName,
      files,
      fileList: Object.keys(files).sort(),
      hasManifest: !!manifestRaw,
      detectedRuntime: detectRuntime(files),
      agentName: agentName ?? folderName,
    });
    setStep('preview');
  }, []);

  // Modern File System Access API path
  const handlePickFolder = useCallback(async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const dir = await (window as unknown as { showDirectoryPicker(): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
        const files: File[] = [];
        async function collectFiles(handle: FileSystemDirectoryHandle, prefix = '') {
          // The File System Access API's entries() method isn't in TypeScript's
          // default lib types. Access the async iterator via a structural cast.
          type EntryIterable = { entries(): AsyncIterable<[string, FileSystemHandle]> };
          const entries = (handle as unknown as EntryIterable).entries();
          for await (const [name, entry] of entries) {
            if (entry.kind === 'file') {
              const file = await (entry as FileSystemFileHandle).getFile();
              Object.defineProperty(file, 'webkitRelativePath', {
                value: `${prefix}${name}`, writable: false,
              });
              files.push(file);
            } else if (entry.kind === 'directory') {
              await collectFiles(entry as FileSystemDirectoryHandle, `${prefix}${name}/`);
            }
          }
        }
        await collectFiles(dir);
        await processFiles(files, dir.name);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          // Fall back to input
          fileInputRef.current?.click();
        }
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [processFiles]);

  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const folderName = files[0].webkitRelativePath.split('/')[0] ?? 'agent';
    await processFiles(files, folderName);
  }, [processFiles]);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    setStep('importing');
    try {
      const res = await fetch('/api/registry/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: preview.folderName, files: preview.files }),
      });
      const data = await res.json() as ImportResult;
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Import failed');
      setResult(data);
      setStep('done');
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('error');
    }
  }, [preview, onImported]);

  const reset = () => { setStep('idle'); setPreview(null); setResult(null); setError(''); };

  return (
    <div className="w-full">
      {/* Hidden fallback input */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {step === 'idle' && (
        <button
          onClick={handlePickFolder}
          className="w-full border-2 border-dashed border-white/20 rounded-2xl p-10
                     flex flex-col items-center gap-3 hover:border-indigo-500/60
                     hover:bg-indigo-500/5 transition-all group"
        >
          <span className="text-4xl group-hover:scale-110 transition-transform">📁</span>
          <span className="text-white/70 font-medium">Drop agent folder or click to browse</span>
          <span className="text-white/30 text-xs">
            Supports: agent.json · bio.md · avatar.png · workflows/ · mcp.json · acp.json · cli.json
          </span>
        </button>
      )}

      {step === 'reading' && (
        <div className="text-center py-10 text-white/50">Reading folder…</div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white/5 border border-white/10 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-white text-lg">{preview.agentName}</h3>
                <p className="text-white/40 text-xs font-mono">{preview.folderName}/</p>
              </div>
              <div className="flex gap-2">
                <span className="px-2 py-0.5 rounded text-xs bg-indigo-500/20 text-indigo-400">
                  {preview.detectedRuntime}
                </span>
                {preview.hasManifest ? (
                  <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">agent.json ✓</span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400">no agent.json</span>
                )}
              </div>
            </div>

            <p className="text-xs text-white/40 mb-2">{preview.fileList.length} files detected:</p>
            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {preview.fileList.map((f) => (
                <p key={f} className="text-xs font-mono text-white/50">{f}</p>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleImport}
              className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500
                         text-white font-semibold transition-colors"
            >
              Import Agent
            </button>
            <button
              onClick={reset}
              className="px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="text-center py-10 text-indigo-400 font-medium">Importing…</div>
      )}

      {step === 'done' && result && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-5 space-y-2">
          <p className="text-emerald-400 font-bold text-lg">✓ Agent Imported</p>
          <p className="text-white/60">Name: <span className="text-white">{result.agent?.name}</span></p>
          <p className="text-white/60">Slug: <span className="font-mono text-white/80">{result.agent?.slug}</span></p>
          <p className="text-white/60">Workflows: <span className="text-white">{result.workflowsImported}</span></p>
          <button onClick={reset} className="mt-2 text-sm text-white/40 hover:text-white/70 underline">
            Import another
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-5">
          <p className="text-red-400 font-bold">Import failed</p>
          <p className="text-white/50 text-sm mt-1">{error}</p>
          <button onClick={reset} className="mt-3 text-sm text-white/40 hover:text-white/70 underline">Try again</button>
        </div>
      )}
    </div>
  );
}
