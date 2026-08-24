const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
// Canonical Draymond port (see src/lib/draymond/ports.ts).
const PORT = Number(process.env.DRAYMOND_PORT || 3444);

function findNodeBin() {
  // Use the system Node, not Electron's bundled runtime — the Next standalone
  // server expects a plain Node environment.
  const candidates = [
    process.env.DRAYMOND_NODE_BIN,
    'C:/Program Files/nodejs/node.exe',
    process.env.NODE_BIN,
  ].filter(Boolean);
  for (const c of candidates) {
    try { require('fs').accessSync(c); return c; } catch {}
  }
  return 'node'; // fall back to PATH
}

function startNextServer() {
  // Spawn the Next.js standalone server. Two layouts are supported:
  //   1. `.next/standalone/server.js` (stock Next standalone build output)
  //   2. `<app>/server.js` (portable layout with standalone at app root)
  const nodeBin = findNodeBin();
  // In a packaged app the standalone output is unpacked to
  // resources/app.asar.unpacked/ so the spawned system node (which cannot read
  // asar archives) can actually load it. In dev the standalone sits next to
  // electron/ at the project root.
  const appRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : path.join(__dirname, '..');
  const standaloneCandidates = [
    path.join(appRoot, '.next/standalone/server.js'),
    path.join(appRoot, 'server.js'),
  ];
  const standalone = standaloneCandidates.find((p) => { try { require('fs').accessSync(p); return true; } catch { return false; } });
  if (!standalone) {
    console.error('[next] standalone server not found; looked at', standaloneCandidates);
    return;
  }

  // The packaged app's asar is read-only, so point the SQLite DB and the
  // releases directory at Electron's writable userData folder unless the user
  // overrode them in the environment.
  const env = {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  };
  if (!env.DRAYMOND_DB_PATH) {
    env.DRAYMOND_DB_PATH = path.join(app.getPath('userData'), 'draymond.db');
  }
  if (!env.DRAYMOND_RELEASES_DIR) {
    env.DRAYMOND_RELEASES_DIR = path.join(app.getPath('userData'), 'paid-releases');
  }

  serverProcess = spawn(nodeBin, [standalone], {
    cwd: appRoot,
    env,
    stdio: 'pipe',
  });
  serverProcess.stdout.on('data', (data) => console.log(`[next] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[next] ${data}`));
  serverProcess.on('exit', (code) => {
    console.error(`[next] server exited with code ${code}`);
    serverProcess = null;
  });
}

/** Poll the health endpoint until the server responds or we give up. */
function waitForServer(timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/v1/health', timeout: 2000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('timeout', () => { req.destroy(); retry(); });
      req.on('error', () => retry());
      function retry() {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 1000);
      }
    };
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Draymond Orchestrator',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Wait for Next.js server to boot before loading the UI.
  waitForServer().then((ready) => {
    if (!ready) {
      mainWindow.loadURL('data:text/html,<h2>Draymond server did not start</h2>');
      return;
    }
    mainWindow.loadURL(`http://localhost:${PORT}`);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  startNextServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
