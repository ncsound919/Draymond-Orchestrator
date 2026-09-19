/**
 * PyodideWorkerManager — single shared Web Worker for all Pyodide consumers.
 *
 * Ported from @mathx/web (apps/web/src/workers/PyodideWorkerManager.ts). One
 * worker, one Pyodide runtime; packages load lazily (numpy/scipy/sympy base,
 * pandas/statsmodels on demand, biopython via micropip).
 *
 * Browser-only — import from client components (this module references the
 * Worker global).
 */
'use client';

// ---------------------------------------------------------------------------
// Worker source — inlined so we don't need a separate file in the build
// ---------------------------------------------------------------------------

const WORKER_SRC = /* javascript */ `
importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js');

let pyodide = null;
let ready = false;
const loadedPackages = new Set();

async function boot() {
  pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/',
  });
  await pyodide.loadPackage(['numpy', 'scipy', 'sympy']);
  ready = true;
  self.postMessage({ type: 'ready' });
}

boot().catch(e => self.postMessage({ type: 'error', id: 'boot', error: String(e) }));

self.onmessage = async (e) => {
  const { type, id, code, packages } = e.data;

  if (type === 'load-packages') {
    const toLoad = (packages || []).filter(p => !loadedPackages.has(p));
    if (toLoad.length === 0) {
      self.postMessage({ type: 'packages-loaded', id, loaded: [] });
      return;
    }
    try {
      const nativePackages = toLoad.filter(p => p !== 'biopython');
      const micropipPackages = toLoad.filter(p => p === 'biopython');

      if (nativePackages.length > 0) {
        await pyodide.loadPackage(nativePackages);
        nativePackages.forEach(p => loadedPackages.add(p));
      }

      if (micropipPackages.length > 0) {
        await pyodide.loadPackage('micropip');
        const micropip = pyodide.pyimport('micropip');
        for (const pkg of micropipPackages) {
          try {
            await micropip.install(pkg);
            loadedPackages.add(pkg);
          } catch (err) {
            self.postMessage({ type: 'package-error', id, pkg, error: String(err) });
          }
        }
      }

      self.postMessage({ type: 'packages-loaded', id, loaded: [...toLoad] });
    } catch (err) {
      self.postMessage({ type: 'error', id, error: String(err) });
    }
    return;
  }

  if (type === 'run') {
    if (!ready) {
      self.postMessage({ type: 'error', id, error: 'Pyodide not ready' });
      return;
    }
    try {
      pyodide.runPython(\`
import sys, io
_capture = io.StringIO()
sys.stdout = _capture
\`);
      await pyodide.runPythonAsync(code);
      const out = pyodide.runPython(\`
sys.stdout = sys.__stdout__
_capture.getvalue()
\`);
      self.postMessage({ type: 'result', id, stdout: String(out).trim() });
    } catch (err) {
      try { pyodide.runPython('import sys; sys.stdout = sys.__stdout__'); } catch (_) {}
      self.postMessage({ type: 'error', id, error: String(err) });
    }
    return;
  }

  if (type === 'clear') {
    try {
      pyodide.runPython(\`
_keep = {'__name__', '__doc__', '__package__', '__loader__', '__spec__', '__builtins__'}
_g = globals()
for _k in list(_g.keys()):
    if _k not in _keep:
        del _g[_k]
\`);
    } catch (_) {}
    self.postMessage({ type: 'cleared', id });
  }
};
`;

// ---------------------------------------------------------------------------
// Singleton manager
// ---------------------------------------------------------------------------

type PendingCallback = { resolve: (v: string) => void; reject: (e: string) => void };

class PyodideWorkerManager {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private ready = false;
  private readyCallbacks: Array<() => void> = [];
  private pending = new Map<string, PendingCallback>();
  private loadedPackages = new Set<string>();
  private idCounter = 0;

  constructor() {
    this.boot();
  }

  private boot() {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    this.workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.workerUrl);

    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case 'ready':
          this.ready = true;
          this.readyCallbacks.forEach((cb) => cb());
          this.readyCallbacks = [];
          break;
        case 'result':
          this.pending.get(msg.id)?.resolve(msg.stdout);
          this.pending.delete(msg.id);
          break;
        case 'packages-loaded':
          (msg.loaded as string[]).forEach((p) => this.loadedPackages.add(p));
          this.pending.get(msg.id)?.resolve(msg.loaded.join(','));
          this.pending.delete(msg.id);
          break;
        case 'package-error':
          console.warn('[pyodide] Package install failed: %s:', msg.pkg, msg.error);
          break;
        case 'cleared':
          this.pending.get(msg.id)?.resolve('cleared');
          this.pending.delete(msg.id);
          break;
        case 'error': {
          const cb = this.pending.get(msg.id);
          if (cb) {
            cb.reject(msg.error);
            this.pending.delete(msg.id);
          } else {
            console.error('[pyodide] Worker error:', msg.error);
          }
          break;
        }
      }
    };

    this.worker.onerror = (e) => {
      console.error('[pyodide] Worker crashed:', e);
      this.ready = false;
    };
  }

  private nextId(): string {
    return `py-${++this.idCounter}-${Date.now()}`;
  }

  private whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.readyCallbacks.push(resolve));
  }

  async run(code: string): Promise<string> {
    await this.whenReady();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'run', id, code });
    });
  }

  async loadPackages(packages: string[]): Promise<string[]> {
    const needed = packages.filter((p) => !this.loadedPackages.has(p));
    if (needed.length === 0) return [];

    await this.whenReady();
    const id = this.nextId();
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(needed.filter((p) => this.loadedPackages.has(p))),
        reject,
      });
      this.worker!.postMessage({ type: 'load-packages', id, packages: needed });
    });
  }

  async clear(): Promise<void> {
    await this.whenReady();
    const id = this.nextId();
    return new Promise((resolve) => {
      this.pending.set(id, { resolve: () => resolve(), reject: () => resolve() });
      this.worker!.postMessage({ type: 'clear', id });
    });
  }

  isReady(): boolean {
    return this.ready;
  }

  destroy() {
    this.worker?.terminate();
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.worker = null;
    this.workerUrl = null;
    this.ready = false;
  }
}

// Module-level singleton — created once, shared by all hooks.
let _manager: PyodideWorkerManager | null = null;

export function getPyodideManager(): PyodideWorkerManager {
  if (!_manager) {
    _manager = new PyodideWorkerManager();
  }
  return _manager;
}
