import * as winston from 'winston';
import DailyRotateFile = require('winston-daily-rotate-file');
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Structured logging system using Winston
 * Provides console and file logging with rotation
 */
class Logger {
  private logger: winston.Logger;
  private logDir: string;

  constructor() {
    // Log directory in user data
    this.logDir = path.join(app.getPath('userData'), 'logs');

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

        // Add metadata if present
        if (Object.keys(meta).length > 0) {
          log += ` ${JSON.stringify(meta)}`;
        }

        // Add stack trace if present
        if (stack) {
          log += `\n${stack}`;
        }

        return log;
      })
    );

    // Create daily rotate file transports
    const fileTransport = new DailyRotateFile({
      filename: path.join(this.logDir, 'zima-client-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d', // Keep logs for 14 days
      format: logFormat,
      level: 'info',
    });

    const errorFileTransport = new DailyRotateFile({
      filename: path.join(this.logDir, 'zima-client-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d', // Keep error logs for 30 days
      format: logFormat,
      level: 'error',
    });

    // Console transport with colors
    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      ),
      level: 'debug',
    });

    // Create logger instance
    this.logger = winston.createLogger({
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
      transports: [
        consoleTransport,
        fileTransport,
        errorFileTransport,
      ],
      exitOnError: false,
    });

    // Log initialization
    this.logger.info('Logger initialized', {
      logDir: this.logDir,
      nodeEnv: process.env.NODE_ENV || 'production',
    });
  }

  /**
   * Debug level logging
   */
  debug(message: string, meta?: Record<string, any>): void {
    this.logger.debug(message, meta);
  }

  /**
   * Info level logging
   */
  info(message: string, meta?: unknown): void {
    if (meta !== undefined && meta !== null) {
      this.logger.info(message, typeof meta === 'object' ? meta : { value: String(meta) });
    } else {
      this.logger.info(message);
    }
  }

  /**
   * Warning level logging
   */
  warn(message: string, meta?: unknown): void {
    if (meta !== undefined && meta !== null) {
      this.logger.warn(message, typeof meta === 'object' ? meta : { value: String(meta) });
    } else {
      this.logger.warn(message);
    }
  }

  /**
   * Error level logging
   */
  error(message: string, error?: unknown): void {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: error.message,
        stack: error.stack,
      });
    } else if (error !== undefined && error !== null) {
      // Convert any other type to string for logging
      this.logger.error(message, {
        error: typeof error === 'object' ? error : String(error),
      });
    } else {
      this.logger.error(message);
    }
  }

  /**
   * Get log directory path
   */
  getLogDir(): string {
    return this.logDir;
  }

  /**
   * Get recent log files
   */
  getLogFiles(): string[] {
    try {
      return fs.readdirSync(this.logDir)
        .filter(file => file.endsWith('.log'))
        .map(file => path.join(this.logDir, file))
        .sort((a, b) => {
          const statA = fs.statSync(a);
          const statB = fs.statSync(b);
          return statB.mtime.getTime() - statA.mtime.getTime();
        });
    } catch (error) {
      return [];
    }
  }

  /**
   * Read recent logs (last N lines)
   */
  async getRecentLogs(lines: number = 100): Promise<string[]> {
    const logFiles = this.getLogFiles();
    if (logFiles.length === 0) {
      return [];
    }

    const latestLog = logFiles[0];
    try {
      const content = fs.readFileSync(latestLog, 'utf-8');
      const logLines = content.split('\n').filter(line => line.trim());
      return logLines.slice(-lines);
    } catch (error) {
      this.error('Failed to read log file', error as Error);
      return [];
    }
  }

  /**
   * Clear old log files (older than specified days)
   */
  clearOldLogs(daysToKeep: number = 30): void {
    try {
      const now = Date.now();
      const cutoffTime = now - (daysToKeep * 24 * 60 * 60 * 1000);

      const logFiles = fs.readdirSync(this.logDir);
      let deletedCount = 0;

      for (const file of logFiles) {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        this.info(`Cleared ${deletedCount} old log files`);
      }
    } catch (error) {
      this.error('Failed to clear old logs', error as Error);
    }
  }
}

// Singleton instance
export const logger = new Logger();

// Export winston logger for advanced usage
export { winston };
