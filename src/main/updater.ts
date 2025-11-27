import { autoUpdater, UpdateInfo } from 'electron-updater';
import { dialog, BrowserWindow, app } from 'electron';
import log from 'electron-log';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class UpdateManager {
  private mainWindow: BrowserWindow | null = null;
  private updateCheckInterval: NodeJS.Timeout | null = null;
  private downloadedFilePath: string | null = null;

  constructor() {
    this.setupAutoUpdater();
  }

  public setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  private setupAutoUpdater(): void {
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = log;

    // Set log level
    if (log.transports.file.level) {
      log.transports.file.level = 'info';
    }

    // Update available event
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      log.info('Update available:', info.version);

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-available', info);
      } else {
        // Fallback to dialog if window not available
        this.showUpdateDialog(info);
      }
    });

    // Update not available
    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      log.info('Update not available:', info.version);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-not-available', info);
      }
    });

    // Download progress
    autoUpdater.on('download-progress', (progressObj) => {
      log.info('Download progress:', progressObj.percent);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-download-progress', progressObj);
      }
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info: UpdateInfo, downloadedFile?: string) => {
      log.info('Update downloaded:', info.version);

      // Store the downloaded file path for manual installation
      // electron-updater downloads to app.getPath('userData')/pending
      const cacheDir = path.join(app.getPath('userData'), 'pending');
      try {
        if (fs.existsSync(cacheDir)) {
          const files = fs.readdirSync(cacheDir);
          const debFile = files.find(f => f.endsWith('.deb'));
          if (debFile) {
            this.downloadedFilePath = path.join(cacheDir, debFile);
            log.info('Downloaded .deb file:', this.downloadedFilePath);
          }
        }
      } catch (err) {
        log.warn('Could not find downloaded file:', err);
      }

      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-downloaded', info);
      } else {
        // Fallback to dialog
        this.showUpdateReadyDialog(info);
      }
    });

    // Error handling
    autoUpdater.on('error', (error) => {
      log.error('Update error:', error);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('update-error', error.message);
      }
    });
  }

  private showUpdateDialog(info: UpdateInfo): void {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update verfügbar',
      message: `Version ${info.version} ist verfügbar. Möchten Sie das Update jetzt herunterladen?`,
      detail: `Aktuelle Version: ${autoUpdater.currentVersion}\nNeue Version: ${info.version}`,
      buttons: ['Ja, herunterladen', 'Später'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  }

  private showUpdateReadyDialog(info: UpdateInfo): void {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update bereit',
      message: `Version ${info.version} wurde heruntergeladen und wird beim nächsten Neustart installiert.`,
      buttons: ['Jetzt neu starten', 'Später'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  }

  public async checkForUpdates(): Promise<void> {
    log.info('Checking for updates...');
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      log.error('Error checking for updates:', error);
      // Send error to renderer so UI can update
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.mainWindow.webContents.send('update-error', errorMessage);
      }
    }
  }

  public downloadUpdate(): void {
    log.info('Starting update download...');
    autoUpdater.downloadUpdate().catch((error) => {
      log.error('Error downloading update:', error);
    });
  }

  public async quitAndInstall(): Promise<void> {
    // On Linux with .deb, use pkexec dpkg -i directly
    if (process.platform === 'linux' && this.downloadedFilePath && this.downloadedFilePath.endsWith('.deb')) {
      log.info('Installing .deb update via pkexec dpkg -i:', this.downloadedFilePath);

      try {
        // Use pkexec to run dpkg -i with elevated privileges
        await execAsync(`pkexec dpkg -i "${this.downloadedFilePath}"`);
        log.info('Update installed successfully, restarting...');

        // Restart the app
        app.relaunch();
        app.exit(0);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error('Failed to install update via dpkg:', errorMessage);

        // Check if it's a polkit/authorization error
        const isAuthError = errorMessage.includes('code 100') || errorMessage.includes('126') || errorMessage.includes('Not authorized');

        // Send error to renderer
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const userMessage = isAuthError
            ? 'Autorisierung abgebrochen. Bitte manuell installieren.'
            : `Installation fehlgeschlagen: ${errorMessage}`;
          this.mainWindow.webContents.send('update-error', userMessage);
        }

        // Show dialog with manual instructions
        const result = await dialog.showMessageBox({
          type: isAuthError ? 'info' : 'error',
          title: isAuthError ? 'Manuelle Installation erforderlich' : 'Update Installation fehlgeschlagen',
          message: isAuthError
            ? 'Die Autorisierung wurde abgebrochen oder ist nicht verfügbar.'
            : 'Das Update konnte nicht automatisch installiert werden.',
          detail: `Bitte öffnen Sie ein Terminal und führen Sie aus:\n\nsudo dpkg -i "${this.downloadedFilePath}"\n\nDanach starten Sie die App neu.`,
          buttons: ['Befehl kopieren', 'Schließen'],
          defaultId: 0,
          cancelId: 1
        });

        // Copy command to clipboard if user clicked "Befehl kopieren"
        if (result.response === 0) {
          const { clipboard } = require('electron');
          clipboard.writeText(`sudo dpkg -i "${this.downloadedFilePath}"`);
        }
      }
    } else {
      // Fallback to default electron-updater behavior (AppImage, etc.)
      autoUpdater.quitAndInstall();
    }
  }

  public startPeriodicCheck(intervalHours: number = 24): void {
    // Clear existing interval if any
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    // Check immediately
    this.checkForUpdates();

    // Set up periodic checks
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalHours * 60 * 60 * 1000);

    log.info(`Periodic update check started (every ${intervalHours} hours)`);
  }

  public stopPeriodicCheck(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
      log.info('Periodic update check stopped');
    }
  }

  public getCurrentVersion(): string {
    return autoUpdater.currentVersion.version;
  }
}

export const updateManager = new UpdateManager();
