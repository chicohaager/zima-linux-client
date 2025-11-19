import { app, dialog } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { BackupJob, BackupProgress, ShareSpace, SMBShare } from '@shared/types';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export class BackupManager extends EventEmitter {
  private configDir: string;
  private configFile: string;
  private jobs: Map<string, BackupJob>;
  private runningJobs: Map<string, any>; // jobId -> process

  constructor() {
    super();
    this.configDir = path.join(app.getPath('home'), '.config/zima-client');
    this.configFile = path.join(this.configDir, 'backup-jobs.json');
    this.jobs = new Map();
    this.runningJobs = new Map();
    this.ensureConfigExists();
    this.loadJobs();
  }

  private ensureConfigExists(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.configFile)) {
      fs.writeFileSync(this.configFile, JSON.stringify([]), 'utf-8');
    }
  }

  private loadJobs(): void {
    try {
      const data = fs.readFileSync(this.configFile, 'utf-8');
      const jobs: BackupJob[] = JSON.parse(data);
      this.jobs.clear();
      jobs.forEach(job => this.jobs.set(job.id, job));
    } catch (error) {
      console.error('Failed to load backup jobs:', error);
    }
  }

  private saveJobs(): void {
    try {
      const jobs = Array.from(this.jobs.values());
      fs.writeFileSync(this.configFile, JSON.stringify(jobs, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save backup jobs:', error);
      throw error;
    }
  }

  async selectFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select folder to backup',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  }

  async getShareSpace(share: SMBShare, credentials?: { username: string; password: string }): Promise<ShareSpace> {
    try {
      const url = credentials
        ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${share.host}/${share.name}`
        : `smb://${share.host}/${share.name}`;

      try {
        await execAsync(`gio mount "${url}"`, { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        // May already be mounted
      }

      let mountPoint: string | null = null;

      try {
        const { stdout: mountStdout } = await execAsync(`gio info "${url}" | grep "standard::target-uri" || echo ""`, { timeout: 5000 });
        if (mountStdout.trim()) {
          const match = mountStdout.match(/file:\/\/([^\s]+)/);
          if (match) {
            mountPoint = decodeURIComponent(match[1]);
          }
        }
      } catch (error) {
        // gio info failed
      }

      if (!mountPoint) {
        const userId = (process.getuid as () => number)();
        const gvfsPath = `/run/user/${userId}/gvfs`;
        if (fs.existsSync(gvfsPath)) {
          const gvfsMounts = fs.readdirSync(gvfsPath);
          const matchingMount = gvfsMounts.find(m => {
            const lowerMount = m.toLowerCase();
            const lowerHost = share.host.toLowerCase();
            const lowerShare = share.name.toLowerCase();
            return lowerMount.includes(lowerHost) && lowerMount.includes(lowerShare);
          });
          if (matchingMount) {
            mountPoint = path.join(gvfsPath, matchingMount);
          }
        }
      }

      if (!mountPoint) {
        return { total: 0, used: 0, available: 0 };
      }

      const { stdout } = await execAsync(`df -B1 "${mountPoint}" | tail -n 1`, { timeout: 5000 });
      const parts = stdout.trim().split(/\s+/);

      if (parts.length < 4) {
        return { total: 0, used: 0, available: 0 };
      }

      return {
        total: parseInt(parts[1]),
        used: parseInt(parts[2]),
        available: parseInt(parts[3]),
      };
    } catch (error: any) {
      return { total: 0, used: 0, available: 0 };
    }
  }

  createJob(job: Omit<BackupJob, 'id'>): BackupJob {
    const id = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newJob: BackupJob = { id, ...job };
    this.jobs.set(id, newJob);
    this.saveJobs();
    return newJob;
  }

  listJobs(): BackupJob[] {
    return Array.from(this.jobs.values());
  }

  deleteJob(jobId: string): void {
    // Stop the job if it's running
    if (this.runningJobs.has(jobId)) {
      console.log(`[Backup] Stopping running job before deletion: ${jobId}`);
      try {
        this.stopJob(jobId);
      } catch (error) {
        console.error('[Backup] Error stopping job:', error);
      }
    }
    this.jobs.delete(jobId);
    this.saveJobs();
  }

  async runJob(jobId: string, credentials?: { username: string; password: string }): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Backup job not found: ${jobId}`);
    }

    if (this.runningJobs.has(jobId)) {
      throw new Error('Backup job is already running');
    }

    job.lastStatus = 'running';
    job.lastRun = Date.now();
    this.saveJobs();

    const startTime = Date.now();

    try {
      const url = credentials
        ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${job.targetShare.host}/${job.targetShare.name}`
        : `smb://${job.targetShare.host}/${job.targetShare.name}`;

      console.log(`[Backup] Attempting to mount: ${url}`);

      try {
        const { stdout: mountOut, stderr: mountErr } = await execAsync(`gio mount "${url}"`, { timeout: 10000 });
        console.log('[Backup] Mount stdout:', mountOut);
        if (mountErr) console.log('[Backup] Mount stderr:', mountErr);
      } catch (error: any) {
        console.log('[Backup] Mount command failed (may already be mounted):', error.message);
      }

      let mountPoint: string | null = null;

      // Try to get mount point from gio info first
      try {
        console.log('[Backup] Trying gio info to get mount point...');
        const { stdout: mountStdout } = await execAsync(`gio info "${url}" | grep "standard::target-uri" || echo ""`, { timeout: 5000 });
        console.log('[Backup] gio info output:', mountStdout);
        if (mountStdout.trim()) {
          const match = mountStdout.match(/file:\/\/([^\s]+)/);
          if (match) {
            mountPoint = decodeURIComponent(match[1]);
            console.log('[Backup] Found mount point from gio info:', mountPoint);
          }
        }
      } catch (error: any) {
        console.log('[Backup] gio info failed:', error.message);
      }

      // Fallback: check gvfs directory
      if (!mountPoint) {
        console.log('[Backup] Falling back to gvfs directory check...');
        const userId = (process.getuid as () => number)();
        const gvfsPath = `/run/user/${userId}/gvfs`;
        console.log('[Backup] Checking gvfs path:', gvfsPath);

        if (fs.existsSync(gvfsPath)) {
          const gvfsMounts = fs.readdirSync(gvfsPath);
          console.log('[Backup] Found gvfs mounts:', gvfsMounts);
          const matchingMount = gvfsMounts.find(m => {
            const lowerMount = m.toLowerCase();
            const lowerHost = job.targetShare.host.toLowerCase();
            const lowerShare = job.targetShare.name.toLowerCase();
            return lowerMount.includes(lowerHost) && lowerMount.includes(lowerShare);
          });
          if (matchingMount) {
            mountPoint = path.join(gvfsPath, matchingMount);
            console.log('[Backup] Found mount point from gvfs:', mountPoint);
          } else {
            console.log('[Backup] No matching mount found. Looking for host:', job.targetShare.host, 'share:', job.targetShare.name);
          }
        } else {
          console.log('[Backup] gvfs path does not exist');
        }
      }

      if (!mountPoint) {
        console.error('[Backup] Could not find mount point for target share');
        console.error('[Backup] Target share details:', JSON.stringify(job.targetShare));
        throw new Error('Could not find mount point for target share');
      }

      console.log('[Backup] Using mount point:', mountPoint);

      const targetPath = path.join(mountPoint, job.targetPath.replace(/^\//, ''));

      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath, { recursive: true });
      }

      const rsyncCmd = `rsync -rtv --progress --stats --no-perms --no-owner --no-group --inplace --modify-window=1 --ignore-errors "${job.sourcePath}/" "${targetPath}/"`;
      const rsyncProcess = exec(rsyncCmd, { maxBuffer: 10 * 1024 * 1024 });
      this.runningJobs.set(jobId, rsyncProcess);

      let filesTransferred = 0;
      let bytesTransferred = 0;
      let totalFiles = 0;
      let totalBytes = 0;
      let currentFile = '';
      let lastProgressUpdate = Date.now();
      let currentSpeed = 0; // bytes per second
      let speedSamples: number[] = []; // for averaging

      // Helper function to parse speed from rsync output (e.g., "123.45kB/s" -> bytes/s)
      const parseSpeed = (speedStr: string): number => {
        const match = speedStr.match(/([\d,.]+)([kKmMgG]?)[bB]\/s/);
        if (!match) return 0;

        const value = parseFloat(match[1].replace(/,/g, ''));
        const unit = match[2].toLowerCase();

        switch (unit) {
          case 'k': return value * 1024;
          case 'm': return value * 1024 * 1024;
          case 'g': return value * 1024 * 1024 * 1024;
          default: return value;
        }
      };

      // Parse rsync output for progress
      rsyncProcess.stdout?.on('data', (data: string) => {
        const output = data.toString();
        const lines = output.split('\n');

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines
          if (!trimmedLine) continue;

          // Parse rsync progress lines (e.g., "  1,234,567  45%  123.45kB/s    0:00:12")
          // Format: bytes transferred, percentage, speed, time
          const progressMatch = line.match(/^\s*[\d,]+\s+(\d+)%\s+([\d.]+[kKmMgG]?[bB]\/s)\s+(\d+:\d+:\d+|\d+:\d+)/);
          if (progressMatch) {
            const speedStr = progressMatch[2];
            const speed = parseSpeed(speedStr);

            if (speed > 0) {
              speedSamples.push(speed);
              // Keep only last 10 samples for averaging
              if (speedSamples.length > 10) {
                speedSamples.shift();
              }
              // Calculate average speed
              currentSpeed = speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length;
            }
            continue;
          }

          // Parse stats from final output
          if (line.includes('Number of files transferred:')) {
            const match = line.match(/:\s*([\d,]+)/);
            if (match) {
              filesTransferred = parseInt(match[1].replace(/,/g, ''));
              console.log(`[Backup] Final files transferred: ${filesTransferred}`);
            }
            continue;
          }
          if (line.includes('Total transferred file size:')) {
            const match = line.match(/:\s*([\d,]+)/);
            if (match) {
              bytesTransferred = parseInt(match[1].replace(/,/g, ''));
              console.log(`[Backup] Final bytes transferred: ${bytesTransferred}`);
            }
            continue;
          }
          if (line.includes('Number of files:') && !line.includes('transferred')) {
            const match = line.match(/:\s*([\d,]+)/);
            if (match) {
              totalFiles = parseInt(match[1].replace(/,/g, ''));
              console.log(`[Backup] Total files: ${totalFiles}`);
            }
            continue;
          }
          if (line.includes('Total file size:')) {
            const match = line.match(/:\s*([\d,]+)/);
            if (match) {
              totalBytes = parseInt(match[1].replace(/,/g, ''));
              console.log(`[Backup] Total bytes: ${totalBytes}`);
            }
            continue;
          }

          // Skip known non-file lines
          if (trimmedLine.startsWith('sending') ||
              trimmedLine.startsWith('sent') ||
              trimmedLine.startsWith('total') ||
              trimmedLine.startsWith('skipping') ||
              trimmedLine.startsWith('building') ||
              trimmedLine.startsWith('created directory') ||
              trimmedLine.includes('speedup is') ||
              trimmedLine.startsWith('Number of') ||
              trimmedLine.startsWith('Total') ||
              trimmedLine.startsWith('Literal') ||
              trimmedLine.startsWith('Matched') ||
              trimmedLine.startsWith('File list') ||
              trimmedLine.match(/^\d+\s+files/)) {
            continue;
          }

          // Match file transfer lines (lines that look like file paths)
          // In rsync -v mode, each transferred file is printed on its own line
          if (trimmedLine.length > 0 &&
              !trimmedLine.match(/^\s*\d+[\d,\s.%]+/) && // Not a progress line with numbers
              trimmedLine.indexOf('/') > 0) { // Contains path separator
            currentFile = trimmedLine;
            filesTransferred++;

            // Estimate bytes based on typical file sizes if we don't have real numbers yet
            // This is just for progress display, real numbers come from stats at the end
            if (totalBytes > 0 && totalFiles > 0) {
              bytesTransferred = Math.round((filesTransferred / totalFiles) * totalBytes);
            }

            // Throttle progress updates to every 100ms
            const now = Date.now();
            if (now - lastProgressUpdate >= 100) {
              lastProgressUpdate = now;

              const percentComplete = totalFiles > 0 ? Math.min(99, Math.round((filesTransferred / totalFiles) * 100)) : 0;
              const elapsedTime = Math.floor((now - startTime) / 1000); // seconds

              // Estimate remaining time based on speed and remaining bytes (if we have total)
              let estimatedTimeRemaining: number | undefined;
              if (currentSpeed > 0 && totalBytes > 0 && bytesTransferred > 0) {
                const remainingBytes = totalBytes - bytesTransferred;
                estimatedTimeRemaining = Math.floor(remainingBytes / currentSpeed);
              }

              console.log(`[Backup] Progress: ${filesTransferred}/${totalFiles} files, ${bytesTransferred} bytes, ${percentComplete}%, ${Math.round(currentSpeed / 1024)}KB/s`);

              const progress: BackupProgress = {
                jobId,
                status: 'running',
                progress: percentComplete,
                currentFile,
                filesTransferred,
                bytesTransferred,
                speed: currentSpeed,
                elapsedTime,
                estimatedTimeRemaining,
              };
              this.emit('progress', progress);
            }
          }
        }
      });

      await new Promise<void>((resolve, reject) => {
        rsyncProcess.on('exit', (code) => {
          this.runningJobs.delete(jobId);

          if (code === 0) {
            resolve();
          } else if (code === 11 || code === 23 || code === 24) {
            if (filesTransferred > 0) {
              resolve();
            } else {
              reject(new Error(`rsync exited with code ${code} and no files were transferred`));
            }
          } else {
            reject(new Error(`rsync failed with exit code ${code}`));
          }
        });

        rsyncProcess.on('error', (error) => {
          this.runningJobs.delete(jobId);
          reject(error);
        });
      });

      const duration = Math.floor((Date.now() - startTime) / 1000);
      job.lastStatus = 'success';
      job.stats = {
        filesTransferred,
        bytesTransferred,
        duration,
        timestamp: Date.now(),
      };
      this.saveJobs();

      this.emit('progress', {
        jobId,
        status: 'completed',
        progress: 100,
        filesTransferred,
        bytesTransferred,
      });
    } catch (error: any) {
      this.runningJobs.delete(jobId);
      job.lastStatus = 'failed';
      job.lastError = error.message;
      this.saveJobs();

      this.emit('progress', {
        jobId,
        status: 'failed',
        progress: 0,
        filesTransferred: 0,
        bytesTransferred: 0,
        error: error.message,
      });

      throw error;
    }
  }

  stopJob(jobId: string): void {
    const process = this.runningJobs.get(jobId);
    if (!process) {
      throw new Error('Backup job is not running');
    }

    process.kill('SIGTERM');
    this.runningJobs.delete(jobId);

    const job = this.jobs.get(jobId);
    if (job) {
      job.lastStatus = 'failed';
      job.lastError = 'Stopped by user';
      this.saveJobs();
    }
  }
}
