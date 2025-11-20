import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { IPCHandlers } from './ipc/handlers';

// Suppress Electron security warnings for local HTTP connections
// ZimaOS typically runs on local network via HTTP which is acceptable
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow: BrowserWindow | null = null;
let ipcHandlers: IPCHandlers | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    title: 'ZimaOS Client',
    icon: path.join(__dirname, '../../logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    backgroundColor: '#1A1A1A',
    show: false,
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools in development
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize IPC handlers
  ipcHandlers = new IPCHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup
  if (ipcHandlers) {
    await ipcHandlers.cleanup();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
