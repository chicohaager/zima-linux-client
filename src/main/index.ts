import { app, BrowserWindow } from 'electron';
import { logger } from './utils/logger';
import * as path from 'path';
import { IPCHandlers } from './ipc/handlers';
import { updateManager } from './updater';
import { initSentry, captureException, flushSentry } from './utils/sentry';

// Initialize Sentry for error monitoring
initSentry();

// Suppress Electron security warnings for local HTTP connections
// ZimaOS typically runs on local network via HTTP which is acceptable
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let mainWindow: BrowserWindow | null = null;
let ipcHandlers: IPCHandlers | null = null;
let isCleaningUp = false;

/**
 * Perform cleanup with timeout protection
 * Ensures app doesn't hang if cleanup takes too long
 */
async function performCleanup(): Promise<void> {
  if (isCleaningUp || !ipcHandlers) return;
  isCleaningUp = true;

  const cleanupPromise = ipcHandlers.cleanup();
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      logger.warn('⚠️  Cleanup timeout after 5s, forcing quit');
      resolve();
    }, 5000);
  });

  try {
    await Promise.race([cleanupPromise, timeoutPromise]);
    logger.info('✓ Cleanup completed');
  } catch (error) {
    logger.error('❌ Cleanup error:', error);
  }
}

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

    // Set the main window for update manager
    if (mainWindow) {
      updateManager.setMainWindow(mainWindow);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize IPC handlers
  ipcHandlers = new IPCHandlers();

  createWindow();

  // Start periodic update checks (every 24 hours) in production
  if (process.env.NODE_ENV === 'production') {
    updateManager.startPeriodicCheck(24);
  }

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

app.on('before-quit', async (event) => {
  event.preventDefault();
  await performCleanup();
  await flushSentry(); // Ensure all error reports are sent
  app.exit(0);
});

// Handle uncaught exceptions - perform cleanup before exiting
process.on('uncaughtException', async (error) => {
  logger.error('❌ Uncaught exception:', error);
  captureException(error, { context: 'uncaughtException' });
  await flushSentry(); // Ensure error is sent before exit
  await performCleanup();
  process.exit(1);
});

process.on('unhandledRejection', async (error) => {
  logger.error('❌ Unhandled rejection:', error);
  captureException(
    error instanceof Error ? error : new Error(String(error)),
    { context: 'unhandledRejection' }
  );
  await flushSentry(); // Ensure error is sent before exit
  await performCleanup();
  process.exit(1);
});
