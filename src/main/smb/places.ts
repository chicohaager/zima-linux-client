import * as fs from 'fs';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as os from 'os';
import { SMBShare } from '@shared/types';
import { GTK_BOOKMARKS_PATH, KDE_PLACES_PATH } from '@shared/constants';

export class PlacesManager {
  private gtkBookmarksFile: string;
  private kdePlacesFile: string;

  constructor() {
    this.gtkBookmarksFile = path.join(os.homedir(), GTK_BOOKMARKS_PATH);
    this.kdePlacesFile = path.join(os.homedir(), KDE_PLACES_PATH);
  }

  /**
   * Pin a share to file manager
   * @param share The SMB share to pin
   * @param username Optional username for authentication
   * @param password Optional password (will NOT be stored in bookmarks for security)
   */
  async pinShare(share: SMBShare, username?: string, password?: string): Promise<void> {
    // Build URL with optional credentials
    // Format: smb://user@host/share (password not included in bookmark for security)
    let url: string;
    if (username) {
      url = `smb://${encodeURIComponent(username)}@${share.host}/${share.name}`;
    } else {
      url = `smb://${share.host}/${share.name}`;
    }

    const label = share.displayName;

    // Add to GTK bookmarks (GNOME Files/Nautilus)
    await this.addToGTKBookmarks(url, label);

    // Add to KDE places if it exists
    await this.addToKDEPlaces(url, label);

    logger.info('Share pinned:', { share: share.displayName, user: username ? `(as ${username})` : '(guest)' });

    // If password is provided, try to mount it now with gio
    // This caches credentials in the keyring
    if (username && password) {
      await this.mountWithCredentials(share.host, share.name, username, password);
    }
  }

  /**
   * Mount a share with credentials using gio
   * This stores credentials in the system keyring
   */
  private async mountWithCredentials(
    host: string,
    shareName: string,
    username: string,
    password: string
  ): Promise<void> {
    try {
      const { spawn } = require('child_process');

      // Build gio mount command with credentials
      // Format: smb://user:password@host/share
      const url = `smb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}/${shareName}`;

      logger.info(`Mounting share with gio: smb://${username}@${host}/${shareName}`);

      // Use spawn to avoid shell interpretation of special chars like !
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('gio', ['mount', url], {
          shell: false, // No shell = no special char interpretation
        });

        let stdout = '';
        let stderr = '';
        let completed = false;

        // Send credentials via stdin when prompted
        setTimeout(() => {
          if (!completed && proc.stdin) {
            try {
              // Send username
              proc.stdin.write(`${username}\n`);
              // Send password
              proc.stdin.write(`${password}\n`);
              // Send domain (default)
              proc.stdin.write(`\n`);
              proc.stdin.end();
            } catch (e) {
              // Ignore write errors if process already closed
            }
          }
        }, 100);

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (code: number | null) => {
          completed = true;
          if (code === 0) {
            resolve();
          } else {
            const error: any = new Error(`gio mount failed with exit code ${code}`);
            error.code = code;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          }
        });

        proc.on('error', (err: Error) => {
          completed = true;
          reject(err);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!completed) {
            completed = true;
            proc.kill();
            const error: any = new Error('Mount timeout');
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
          }
        }, 10000);
      });

      logger.info('✓ Share mounted and credentials cached in keyring');
    } catch (error: any) {
      // Mounting might fail if already mounted or other issues
      // This is not critical as the bookmark is still created
      logger.warn('gio mount failed (share may already be mounted):', error.message);
      if (error.stdout) logger.warn('Mount stdout:', error.stdout);
      if (error.stderr) logger.warn('Mount stderr:', error.stderr);
    }
  }

  async unpinShare(shareUrl: string): Promise<void> {
    // Remove from GTK bookmarks
    await this.removeFromGTKBookmarks(shareUrl);

    // Remove from KDE places
    await this.removeFromKDEPlaces(shareUrl);

    logger.info('Share unpinned:', shareUrl);
  }

  private async addToGTKBookmarks(url: string, label: string): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.gtkBookmarksFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Read existing bookmarks
      let bookmarks = '';
      if (fs.existsSync(this.gtkBookmarksFile)) {
        bookmarks = fs.readFileSync(this.gtkBookmarksFile, 'utf-8');
      }

      // Add new bookmark if not exists
      const line = `${url} ${label}\n`;
      if (!bookmarks.includes(url)) {
        bookmarks += line;
        fs.writeFileSync(this.gtkBookmarksFile, bookmarks);
        logger.info('Added to GTK bookmarks');
      }
    } catch (error) {
      logger.error('Failed to add GTK bookmark:', error);
    }
  }

  private async removeFromGTKBookmarks(shareUrl: string): Promise<void> {
    try {
      if (!fs.existsSync(this.gtkBookmarksFile)) return;

      let bookmarks = fs.readFileSync(this.gtkBookmarksFile, 'utf-8');
      const lines = bookmarks.split('\n');

      bookmarks = lines
        .filter(line => !line.includes(shareUrl))
        .join('\n');

      fs.writeFileSync(this.gtkBookmarksFile, bookmarks);
      logger.info('Removed from GTK bookmarks');
    } catch (error) {
      logger.error('Failed to remove GTK bookmark:', error);
    }
  }

  private async addToKDEPlaces(url: string, label: string): Promise<void> {
    try {
      if (!fs.existsSync(this.kdePlacesFile)) {
        // Create basic XBEL structure
        const xbel = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xbel>
<xbel xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info" xmlns:kdepriv="http://www.kde.org/kdepriv">
</xbel>`;

        const dir = path.dirname(this.kdePlacesFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(this.kdePlacesFile, xbel);
      }

      let xml = fs.readFileSync(this.kdePlacesFile, 'utf-8');

      // Check if bookmark already exists
      if (xml.includes(`href="${url}"`)) {
        return;
      }

      // Add bookmark before closing </xbel> tag
      const bookmark = `  <bookmark href="${url}">
    <title>${this.escapeXml(label)}</title>
    <info>
      <metadata owner="http://freedesktop.org">
        <bookmark:icon name="folder-remote"/>
      </metadata>
    </info>
  </bookmark>\n`;

      xml = xml.replace('</xbel>', `${bookmark}</xbel>`);
      fs.writeFileSync(this.kdePlacesFile, xml);

      logger.info('Added to KDE places');
    } catch (error) {
      logger.error('Failed to add KDE place:', error);
    }
  }

  private async removeFromKDEPlaces(shareUrl: string): Promise<void> {
    try {
      if (!fs.existsSync(this.kdePlacesFile)) return;

      let xml = fs.readFileSync(this.kdePlacesFile, 'utf-8');

      // Remove bookmark element containing the URL
      const bookmarkRegex = new RegExp(
        `\\s*<bookmark[^>]*href="${this.escapeRegex(shareUrl)}"[^>]*>.*?</bookmark>\\s*`,
        'gs'
      );

      xml = xml.replace(bookmarkRegex, '');
      fs.writeFileSync(this.kdePlacesFile, xml);

      logger.info('Removed from KDE places');
    } catch (error) {
      logger.error('Failed to remove KDE place:', error);
    }
  }

  async listPinnedShares(): Promise<string[]> {
    const pinned: string[] = [];

    // Read GTK bookmarks
    if (fs.existsSync(this.gtkBookmarksFile)) {
      const bookmarks = fs.readFileSync(this.gtkBookmarksFile, 'utf-8');
      const lines = bookmarks.split('\n');

      for (const line of lines) {
        if (line.startsWith('smb://')) {
          const url = line.split(' ')[0];
          pinned.push(url);
        }
      }
    }

    return pinned;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
