import { Notification, app } from 'electron';
import * as path from 'path';
import { logger } from './logger';

/**
 * Notification manager for system notifications
 * Uses Electron's native notification API
 */
export class NotificationManager {
  private iconPath: string;

  constructor() {
    // Default icon path (update with actual icon location)
    this.iconPath = path.join(__dirname, '../../logo.png');
  }

  /**
   * Show a system notification
   * @param title Notification title
   * @param body Notification body
   * @param silent Whether to play sound (default: false)
   */
  show(title: string, body: string, silent: boolean = false): void {
    if (!Notification.isSupported()) {
      logger.warn('System notifications are not supported on this platform');
      return;
    }

    try {
      const notification = new Notification({
        title,
        body,
        icon: this.iconPath,
        silent,
        urgency: 'normal',
      });

      notification.show();

      notification.on('click', () => {
        logger.info('Notification clicked', { title });
      });

      notification.on('close', () => {
        logger.debug('Notification closed', { title });
      });
    } catch (error) {
      logger.error('Failed to show notification', error);
    }
  }

  /**
   * Show a success notification
   */
  success(title: string, body: string): void {
    this.show(`✓ ${title}`, body);
  }

  /**
   * Show an error notification
   */
  error(title: string, body: string): void {
    this.show(`✗ ${title}`, body);
  }

  /**
   * Show a warning notification
   */
  warning(title: string, body: string): void {
    this.show(`⚠ ${title}`, body);
  }

  /**
   * Show an info notification
   */
  info(title: string, body: string, silent: boolean = true): void {
    this.show(`ℹ ${title}`, body, silent);
  }

  /**
   * Show backup started notification
   */
  backupStarted(jobName: string): void {
    this.info('Backup Started', `Backup job "${jobName}" has started`);
  }

  /**
   * Show backup completed notification
   */
  backupCompleted(jobName: string): void {
    this.success('Backup Completed', `Backup job "${jobName}" completed successfully`);
  }

  /**
   * Show backup failed notification
   */
  backupFailed(jobName: string, error: string): void {
    this.error('Backup Failed', `Backup job "${jobName}" failed: ${error}`);
  }

  /**
   * Show ZeroTier status notification
   */
  zerotierStatus(status: 'started' | 'stopped'): void {
    if (status === 'started') {
      this.success('ZeroTier Started', 'ZeroTier network service is now running');
    } else {
      this.info('ZeroTier Stopped', 'ZeroTier network service has been stopped');
    }
  }

  /**
   * Show update available notification
   */
  updateAvailable(version: string): void {
    this.info('Update Available', `Version ${version} is ready to install`);
  }

  /**
   * Show device connected notification
   */
  deviceConnected(deviceName: string): void {
    this.success('Device Connected', `Successfully connected to ${deviceName}`);
  }

  /**
   * Show device disconnected notification
   */
  deviceDisconnected(deviceName: string): void {
    this.warning('Device Disconnected', `Lost connection to ${deviceName}`);
  }
}

// Singleton instance
export const notificationManager = new NotificationManager();
