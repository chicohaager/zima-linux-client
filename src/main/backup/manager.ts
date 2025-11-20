import { app, dialog } from 'electron';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { BackupJob, BackupProgress, ShareSpace, SMBShare, BackupSchedule } from '@shared/types';
import { EventEmitter } from 'events';
import * as cron from 'node-cron';

const execAsync = promisify(exec);

// Helper to find existing mount point by checking file manager bookmarks
async function findMountPointFromBookmarks(host: string, shareName: string): Promise<string | null> {
  try {
    const bookmarkFile = path.join(require('os').homedir(), '.config/gtk-3.0/bookmarks');
    if (!fs.existsSync(bookmarkFile)) {
      console.log('[Mount] No GTK bookmarks file found');
      return null;
    }

    const bookmarks = fs.readFileSync(bookmarkFile, 'utf-8');
    const lines = bookmarks.split('\n');

    for (const line of lines) {
      if (line.startsWith('smb://') && line.includes(host) && line.toLowerCase().includes(shareName.toLowerCase())) {
        // Extract the URI
        const uri = line.split(' ')[0];
        console.log('[Mount] Found bookmark:', uri);

        // Try to resolve it with gio info
        try {
          const { stdout } = await execAsync(`gio info "${uri}" 2>/dev/null | grep "standard::target-uri" || echo ""`);
          if (stdout.trim()) {
            const match = stdout.match(/file:\/\/([^\s]+)/);
            if (match) {
              const mountPoint = decodeURIComponent(match[1]);
              console.log('[Mount] Resolved mount point from bookmark:', mountPoint);
              if (fs.existsSync(mountPoint)) {
                return mountPoint;
              }
            }
          }
        } catch (error) {
          console.log('[Mount] gio info failed for bookmark');
        }
      }
    }

    return null;
  } catch (error) {
    console.log('[Mount] Error reading bookmarks:', error);
    return null;
  }
}

// Helper to spawn gio mount without shell interpretation
// Optionally provides credentials via stdin for interactive prompts
function spawnGioMount(url: string, credentials?: { username: string; password: string }, timeoutMs: number = 10000): Promise<{stdout: string, stderr: string}> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gio', ['mount', url], {
      shell: false, // Critical: no shell means no special char interpretation
    });

    let stdout = '';
    let stderr = '';
    let completed = false;

    // Set timeout to kill process if it hangs
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        proc.kill('SIGTERM');
        const error: any = new Error(`gio mount timed out after ${timeoutMs}ms`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    }, timeoutMs);

    // If credentials provided, send them to stdin when prompted
    if (credentials && proc.stdin) {
      // Wait a bit for prompt, then send username and password
      setTimeout(() => {
        if (!completed && proc.stdin) {
          try {
            // Send username (gio will prompt for it)
            proc.stdin.write(`${credentials.username}\n`);
            // Send password
            proc.stdin.write(`${credentials.password}\n`);
            // Send domain (just press enter to use default)
            proc.stdin.write(`\n`);
            proc.stdin.end();
          } catch (e) {
            // Ignore write errors if process already closed
          }
        }
      }, 100);
    }

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const error: any = new Error(`gio mount failed with exit code ${code}`);
          error.code = code;
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        }
      }
    });

    proc.on('error', (err: Error) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

// Helper function to safely quote strings for shell commands
// Uses single quotes to avoid shell interpretation of special chars like !
function shellQuote(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export class BackupManager extends EventEmitter {
  private configDir: string;
  private configFile: string;
  private jobs: Map<string, BackupJob>;
  private runningJobs: Map<string, any>; // jobId -> process
  private scheduledTasks: Map<string, cron.ScheduledTask>; // jobId -> cron task

  constructor() {
    super();
    this.configDir = path.join(app.getPath('home'), '.config/zima-client');
    this.configFile = path.join(this.configDir, 'backup-jobs.json');
    this.jobs = new Map();
    this.runningJobs = new Map();
    this.scheduledTasks = new Map();
    this.ensureConfigExists();
    this.loadJobs();
    this.initializeSchedules();
  }

  /**
   * Convert BackupSchedule to cron expression
   */
  private scheduleToCron(schedule: BackupSchedule): string | null {
    const { frequency, time, dayOfWeek, dayOfMonth } = schedule;

    if (frequency === 'manual' || !time) return null;

    const [hour, minute] = time.split(':').map(Number);

    switch (frequency) {
      case 'daily':
        // Run every day at specified time
        return `${minute} ${hour} * * *`;

      case 'weekly':
        // Run on specified day of week at specified time
        const day = dayOfWeek ?? 0;
        return `${minute} ${hour} * * ${day}`;

      case 'monthly':
        // Run on specified day of month at specified time
        const dayNum = dayOfMonth ?? 1;
        return `${minute} ${hour} ${dayNum} * *`;

      default:
        return null;
    }
  }

  /**
   * Initialize all scheduled backup jobs
   */
  private initializeSchedules(): void {
    this.jobs.forEach((job, jobId) => {
      if (job.enabled && job.schedule && job.schedule.frequency !== 'manual') {
        this.scheduleJob(jobId, job);
      }
    });
    console.log(`✓ Initialized ${this.scheduledTasks.size} scheduled backup jobs`);
  }

  /**
   * Schedule a backup job using cron
   */
  private scheduleJob(jobId: string, job: BackupJob): void {
    // Remove existing schedule if any
    this.unscheduleJob(jobId);

    if (!job.schedule || job.schedule.frequency === 'manual') {
      return;
    }

    const cronExpression = this.scheduleToCron(job.schedule);
    if (!cronExpression) {
      console.warn(`⚠️  Invalid schedule for job ${job.name}`);
      return;
    }

    try {
      const task = cron.schedule(cronExpression, async () => {
        console.log(`🕐 Running scheduled backup: ${job.name}`);
        try {
          await this.runJob(jobId, job.credentials);
        } catch (error: any) {
          console.error(`❌ Scheduled backup failed for ${job.name}:`, error.message);
        }
      });

      this.scheduledTasks.set(jobId, task);
      console.log(`✓ Scheduled backup "${job.name}" with cron: ${cronExpression}`);
    } catch (error: any) {
      console.error(`❌ Failed to schedule job ${job.name}:`, error.message);
    }
  }

  /**
   * Remove scheduled task for a job
   */
  private unscheduleJob(jobId: string): void {
    const task = this.scheduledTasks.get(jobId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(jobId);
      console.log(`✓ Unscheduled backup job ${jobId}`);
    }
  }

  /**
   * Stop all scheduled tasks (cleanup)
   */
  public stopAllSchedules(): void {
    this.scheduledTasks.forEach(task => task.stop());
    this.scheduledTasks.clear();
    console.log('✓ Stopped all scheduled backup jobs');
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
      let mountPoint: string | null = null;

      // First try to find mount point from bookmarks (for pinned shares)
      console.log('[ShareSpace] Checking for existing mount in bookmarks...');
      mountPoint = await findMountPointFromBookmarks(share.host, share.name);

      if (mountPoint) {
        console.log('[ShareSpace] Found existing mount point from bookmarks:', mountPoint);
      } else {
        // If not found in bookmarks, try to mount
        const url = credentials
          ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${share.host}/${share.name}`
          : `smb://${share.host}/${share.name}`;

        console.log('[ShareSpace] Attempting to mount:', url.replace(/:[^:@]+@/, ':***@'));

        try {
          // Use spawn to avoid shell interpretation of special chars like !
          console.log('[ShareSpace] Mounting with spawn (no shell), timeout 5s, providing credentials via stdin');
          const { stdout, stderr } = await spawnGioMount(url, credentials, 5000);
          console.log('[ShareSpace] Mount succeeded!');
          if (stdout) console.log('[ShareSpace] Mount stdout:', stdout);
          if (stderr) console.log('[ShareSpace] Mount stderr:', stderr);
          // Wait for gvfs to register the mount
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          console.log('[ShareSpace] Mount command failed (may already be mounted)');
          console.log('[ShareSpace] Error message:', error.message);
          console.log('[ShareSpace] Error code:', error.code);
          console.log('[ShareSpace] Error stdout:', error.stdout || '(empty)');
          console.log('[ShareSpace] Error stderr:', error.stderr || '(empty)');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // If we still don't have a mount point, try other methods
      if (!mountPoint) {
        const url = credentials
          ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${share.host}/${share.name}`
          : `smb://${share.host}/${share.name}`;

        try {
          const infoCmd = `gio info ${shellQuote(url)} | grep "standard::target-uri" || echo ""`;
          const { stdout: mountStdout } = await execAsync(infoCmd, { timeout: 5000 });
          console.log('[ShareSpace] gio info output:', mountStdout);
          if (mountStdout.trim()) {
            const match = mountStdout.match(/file:\/\/([^\s]+)/);
            if (match) {
              mountPoint = decodeURIComponent(match[1]);
              console.log('[ShareSpace] Found mount point from gio info:', mountPoint);
            }
          }
        } catch (error: any) {
          console.log('[ShareSpace] gio info failed:', error.message);
        }
      }

      if (!mountPoint) {
        const userId = (process.getuid as () => number)();
        const gvfsPath = `/run/user/${userId}/gvfs`;
        console.log('[ShareSpace] Checking gvfs path:', gvfsPath);

        if (fs.existsSync(gvfsPath)) {
          const gvfsMounts = fs.readdirSync(gvfsPath);
          console.log('[ShareSpace] Found gvfs mounts:', gvfsMounts);

          // Try multiple matching strategies
          let matchingMount = gvfsMounts.find(m => {
            const lowerMount = m.toLowerCase();
            const lowerHost = share.host.toLowerCase().replace(/\./g, '');
            const lowerShare = share.name.toLowerCase().replace(/[-_]/g, '');
            const normalizedMount = lowerMount.replace(/[-_.]/g, '');
            return normalizedMount.includes(lowerHost) && normalizedMount.includes(lowerShare);
          });

          // If still not found, try simple host matching
          if (!matchingMount) {
            matchingMount = gvfsMounts.find(m => {
              return m.toLowerCase().includes(share.host.toLowerCase());
            });
          }

          if (matchingMount) {
            mountPoint = path.join(gvfsPath, matchingMount);
            console.log('[ShareSpace] Found mount point from gvfs:', mountPoint);
          } else {
            console.log('[ShareSpace] No matching mount found for host:', share.host, 'share:', share.name);
          }
        } else {
          console.log('[ShareSpace] gvfs path does not exist');
        }
      }

      if (!mountPoint) {
        console.log('[ShareSpace] Could not find mount point, returning 0 space');
        return { total: 0, used: 0, available: 0 };
      }

      console.log('[ShareSpace] Getting disk space for:', mountPoint);
      const { stdout } = await execAsync(`df -B1 "${mountPoint}" | tail -n 1`, { timeout: 5000 });
      const parts = stdout.trim().split(/\s+/);
      console.log('[ShareSpace] df output parts:', parts);

      if (parts.length < 4) {
        console.log('[ShareSpace] Invalid df output, returning 0 space');
        return { total: 0, used: 0, available: 0 };
      }

      const space = {
        total: parseInt(parts[1]),
        used: parseInt(parts[2]),
        available: parseInt(parts[3]),
      };
      console.log('[ShareSpace] Space info:', space);
      return space;
    } catch (error: any) {
      console.error('[ShareSpace] Error getting space:', error);
      return { total: 0, used: 0, available: 0 };
    }
  }

  createJob(job: Omit<BackupJob, 'id'>): BackupJob {
    const id = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newJob: BackupJob = { id, ...job };
    this.jobs.set(id, newJob);
    this.saveJobs();

    // Schedule the job if it has a schedule and is enabled
    if (newJob.enabled && newJob.schedule && newJob.schedule.frequency !== 'manual') {
      this.scheduleJob(id, newJob);
    }

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

    // Remove scheduled task if exists
    this.unscheduleJob(jobId);

    this.jobs.delete(jobId);
    this.saveJobs();
  }

  updateJob(jobId: string, updates: Partial<Omit<BackupJob, 'id'>>): BackupJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Backup job not found: ${jobId}`);
    }

    // Stop the job if it's running (can't update running jobs)
    if (this.runningJobs.has(jobId)) {
      throw new Error('Cannot update a running job. Please stop it first.');
    }

    // Remove old schedule
    this.unscheduleJob(jobId);

    // Merge updates with existing job
    const updatedJob: BackupJob = {
      ...job,
      ...updates,
      id: jobId, // Ensure ID doesn't change
    };

    this.jobs.set(jobId, updatedJob);
    this.saveJobs();

    // Re-schedule if enabled and has schedule
    if (updatedJob.enabled && updatedJob.schedule && updatedJob.schedule.frequency !== 'manual') {
      this.scheduleJob(jobId, updatedJob);
    }

    return updatedJob;
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
      let mountPoint: string | null = null;

      // First try to find mount point from bookmarks (for pinned shares)
      console.log('[Backup] Checking for existing mount in bookmarks...');
      mountPoint = await findMountPointFromBookmarks(job.targetShare.host, job.targetShare.name);

      if (mountPoint) {
        console.log('[Backup] Found existing mount point from bookmarks:', mountPoint);
      } else {
        // If not found in bookmarks, try to mount
        const url = credentials
          ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${job.targetShare.host}/${job.targetShare.name}`
          : `smb://${job.targetShare.host}/${job.targetShare.name}`;

        console.log(`[Backup] Attempting to mount: ${url.replace(/:[^:@]+@/, ':***@')}`);

        // Try to mount the share - use spawn to avoid shell interpretation
        try {
          console.log('[Backup] Mounting with spawn (no shell), timeout 5s, providing credentials via stdin');
          const { stdout, stderr } = await spawnGioMount(url, credentials, 5000);
          console.log('[Backup] Mount succeeded!');
          if (stdout) console.log('[Backup] Mount stdout:', stdout);
          if (stderr) console.log('[Backup] Mount stderr:', stderr);
          // Wait for gvfs to register the mount
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error: any) {
          console.log('[Backup] Mount command failed (may already be mounted)');
          console.log('[Backup] Error message:', error.message);
          console.log('[Backup] Error code:', error.code);
          console.log('[Backup] Error stdout:', error.stdout || '(empty)');
          console.log('[Backup] Error stderr:', error.stderr || '(empty)');
          // Wait a bit anyway
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // If we still don't have a mount point, try other methods
      if (!mountPoint) {
        const url = credentials
          ? `smb://${encodeURIComponent(credentials.username)}:${encodeURIComponent(credentials.password)}@${job.targetShare.host}/${job.targetShare.name}`
          : `smb://${job.targetShare.host}/${job.targetShare.name}`;

        // Try to get mount point from gio info
        try {
          console.log('[Backup] Trying gio info to get mount point...');
          const infoCmd = `gio info ${shellQuote(url)} | grep "standard::target-uri" || echo ""`;
          const { stdout: mountStdout } = await execAsync(infoCmd, { timeout: 5000 });
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

          // Try multiple matching strategies
          let matchingMount = gvfsMounts.find(m => {
            const lowerMount = m.toLowerCase();
            const lowerHost = job.targetShare.host.toLowerCase().replace(/\./g, '');
            const lowerShare = job.targetShare.name.toLowerCase().replace(/[-_]/g, '');
            const normalizedMount = lowerMount.replace(/[-_.]/g, '');
            return normalizedMount.includes(lowerHost) && normalizedMount.includes(lowerShare);
          });

          // If still not found, try simple host matching
          if (!matchingMount) {
            matchingMount = gvfsMounts.find(m => {
              return m.toLowerCase().includes(job.targetShare.host.toLowerCase());
            });
          }

          if (matchingMount) {
            mountPoint = path.join(gvfsPath, matchingMount);
            console.log('[Backup] Found mount point from gvfs:', mountPoint);
          } else {
            console.log('[Backup] No matching mount found.');
            console.log('[Backup] Looking for host:', job.targetShare.host, 'share:', job.targetShare.name);
            console.log('[Backup] Available mounts:', gvfsMounts.join(', '));
          }
        } else {
          console.log('[Backup] gvfs path does not exist');
        }
      }

      if (!mountPoint) {
        console.error('[Backup] Could not find mount point for target share');
        console.error('[Backup] Target share details:', JSON.stringify(job.targetShare));
        throw new Error(`Could not find mount point for share ${job.targetShare.displayName}. Make sure the share is accessible and try pinning it first from the Apps page.`);
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
