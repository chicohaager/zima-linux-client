import { autoUpdater, UpdateInfo } from 'electron-updater';
import { dialog, BrowserWindow } from 'electron';
import log from 'electron-log';

export class UpdateManager {
  private mainWindow: BrowserWindow | null = null;
  private updateCheckInterval: NodeJS.Timeout | null = null;

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
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      log.info('Update downloaded:', info.version);

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

  public checkForUpdates(): void {
    log.info('Checking for updates...');
    autoUpdater.checkForUpdates().catch((error) => {
      log.error('Error checking for updates:', error);
    });
  }

  public downloadUpdate(): void {
    log.info('Starting update download...');
    autoUpdater.downloadUpdate().catch((error) => {
      log.error('Error downloading update:', error);
    });
  }

  public quitAndInstall(): void {
    autoUpdater.quitAndInstall();
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
