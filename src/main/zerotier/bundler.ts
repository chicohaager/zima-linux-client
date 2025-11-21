import * as path from 'path';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import { app } from 'electron';

export class ZeroTierBundler {
  private binaryPath: string = '';
  private cliPath: string = '';

  constructor() {
    this.extractBinaries();
  }

  private extractBinaries(): void {
    // In development, use binaries from project directory
    const isDev = !app.isPackaged;

    // Determine architecture
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

    let resourcePath: string;
    if (isDev) {
      // Development: use binaries from project
      // __dirname in bundled code = /path/to/dist/main
      resourcePath = path.join(__dirname, '../../bin/zerotier', arch);
    } else {
      // Production: use bundled binaries in resources
      resourcePath = path.join(process.resourcesPath, 'bin/zerotier', arch);
    }

    logger.info('isDev:', isDev);
    logger.info('__dirname:', __dirname);
    logger.info('Looking for ZeroTier binaries at:', resourcePath);

    // Temporary path for execution
    const tempDir = path.join(app.getPath('temp'), 'zerotier');

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const binPath = path.join(tempDir, 'zerotier-one');
    const cliPath = path.join(tempDir, 'zerotier-cli');

    // Copy binary if resource exists
    if (fs.existsSync(resourcePath)) {
      const sourceBin = path.join(resourcePath, 'zerotier-one');
      const sourceCli = path.join(resourcePath, 'zerotier-cli');

      logger.info('Checking for binaries:', { sourceBin, sourceCli });

      if (fs.existsSync(sourceBin)) {
        fs.copyFileSync(sourceBin, binPath);
        fs.chmodSync(binPath, 0o755);
        logger.info('Copied zerotier-one to', binPath);
      } else {
        logger.error('zerotier-one binary not found at', sourceBin);
      }

      if (fs.existsSync(sourceCli)) {
        fs.copyFileSync(sourceCli, cliPath);
        fs.chmodSync(cliPath, 0o755);
        logger.info('Copied zerotier-cli to', cliPath);
      } else {
        logger.error('zerotier-cli binary not found at', sourceCli);
      }
    } else {
      logger.error('ZeroTier resource path does not exist:', resourcePath);
    }

    this.binaryPath = binPath;
    this.cliPath = cliPath;
  }

  getBinaryPath(): string {
    return this.binaryPath;
  }

  getCliPath(): string {
    return this.cliPath;
  }

  cleanup(): void {
    // Clean up temp files on exit
    try {
      if (fs.existsSync(this.binaryPath)) {
        fs.unlinkSync(this.binaryPath);
      }
      if (fs.existsSync(this.cliPath)) {
        fs.unlinkSync(this.cliPath);
      }
    } catch (error) {
      logger.error('Failed to cleanup ZeroTier binaries:', error);
    }
  }
}
