const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;
const PORT = 3000;

function startNextServer() {
  // Use next start to run the production server
  const nextBin = path.join(__dirname, '../node_modules/.bin/next');
  const nextCmd = process.platform === 'win32' ? `${nextBin}.cmd` : nextBin;
  
  serverProcess = spawn(nextCmd, ['start', '--port', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  serverProcess.stdout.on('data', (data) => console.log(`[next] ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`[next] ${data}`));
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

  // Wait for Next.js server to boot
  const tryLoad = (retries = 30) => {
    mainWindow.loadURL(`http://localhost:${PORT}`).catch(() => {
      if (retries > 0) setTimeout(() => tryLoad(retries - 1), 1000);
    });
  };
  tryLoad();

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
