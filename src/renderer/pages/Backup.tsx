import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { BackupJob, SMBShare, ShareSpace, BackupProgress } from '@shared/types';

export const BackupPage: React.FC = () => {
  const { devices, sessionCredentials } = useAppStore();
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [progressMap, setProgressMap] = useState<Map<string, BackupProgress>>(new Map());

  // Add backup dialog state
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [selectedShare, setSelectedShare] = useState<SMBShare | null>(null);
  const [targetPath, setTargetPath] = useState('/Backup');
  const [space, setSpace] = useState<ShareSpace | null>(null);
  const [loadingSpace, setLoadingSpace] = useState(false);

  useEffect(() => {
    loadJobs();

    const onProgress = (window.electron.backup as any).onProgress;
    if (onProgress) {
      const unsubscribe = onProgress((progress: BackupProgress) => {
        setProgressMap(prev => {
          const newMap = new Map(prev);
          newMap.set(progress.jobId, progress);
          return newMap;
        });

        if (progress.status === 'completed' || progress.status === 'failed') {
          setTimeout(() => loadJobs(), 500);
        }
      });

      return () => {
        unsubscribe();
      };
    }
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const result = await window.electron.backup.listJobs();
      if (result.success && result.data) {
        setJobs(result.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const result = await window.electron.backup.selectFolder();
      if (result.success && result.data) {
        setSelectedFolder(result.data);
      }
    } catch (error) {
      alert('Failed to select folder');
    }
  };

  const handleSelectShare = async (share: SMBShare) => {
    setSelectedShare(share);
    setLoadingSpace(true);

    try {
      const result = await window.electron.smb.getSpace(share);
      if (result.success && result.data) {
        setSpace(result.data);
      }
    } catch (error) {
      setSpace(null);
    } finally {
      setLoadingSpace(false);
    }
  };

  const handleCreateJob = async () => {
    if (!selectedFolder || !selectedShare) {
      alert('Please select a folder and a share');
      return;
    }

    try {
      const jobName = selectedFolder.split('/').pop() || 'Backup';

      const result = await window.electron.backup.createJob({
        name: jobName,
        sourcePath: selectedFolder,
        targetShare: selectedShare,
        targetPath,
        enabled: true,
        credentials: sessionCredentials || undefined,
      });

      if (result.success && result.data) {
        setJobs([...jobs, result.data]);
        setShowAddDialog(false);
        setSelectedFolder(null);
        setSelectedShare(null);
        setTargetPath('/Backup');
        setSpace(null);
        alert('Backup job created successfully');
      } else {
        alert(`Failed to create backup job: ${result.error}`);
      }
    } catch (error) {
      alert('Failed to create backup job');
    }
  };

  const handleRunJob = async (jobId: string) => {
    try {
      const job = jobs.find(j => j.id === jobId);
      const credentials = job?.credentials || sessionCredentials || undefined;

      const result = await window.electron.backup.runJob(jobId, credentials);
      if (result.success) {
        alert('Backup started successfully');
        await loadJobs();
      } else {
        alert(`Failed to start backup: ${result.error}`);
      }
    } catch (error) {
      alert('Failed to start backup');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to delete this backup job?')) {
      return;
    }

    try {
      const result = await window.electron.backup.deleteJob(jobId);
      if (result.success) {
        setJobs(jobs.filter(j => j.id !== jobId));
        // Clear progress for deleted job
        setProgressMap(prev => {
          const newMap = new Map(prev);
          newMap.delete(jobId);
          return newMap;
        });
      } else {
        alert(`Failed to delete job: ${result.error}`);
      }
    } catch (error) {
      alert('Failed to delete backup job');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}m ${secs}s`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  const availableShares: SMBShare[] = [];
  devices.forEach(device => {
    if (device.shares) {
      availableShares.push(...device.shares);
    }
  });

  return (
    <div className="px-4 py-8 pb-24">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold text-zima-text-secondary tracking-wider mb-2">BACKUP</p>
          <h1 className="text-3xl font-bold text-zima-blue mb-1">Backup your files</h1>
          <p className="text-3xl font-bold text-zima-blue">to ZimaOS.</p>
        </div>

        <div className="bg-white rounded-3xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-zima-text-primary">Backup Jobs</h2>
            <button
              onClick={() => setShowAddDialog(true)}
              className="bg-zima-blue hover:bg-blue-600 text-white rounded-full px-4 py-2 text-sm font-medium transition-colors"
            >
              + Add Backup
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-10 h-10 border-4 border-zima-blue border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-sm text-zima-text-secondary">Loading...</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-zima-text-secondary">No backup jobs configured</p>
              <p className="text-xs text-zima-text-secondary mt-2">Click "Add Backup" to create your first backup</p>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => {
                const progress = progressMap.get(job.id);
                const isRunning = progress?.status === 'running' || job.lastStatus === 'running';

                return (
                  <div key={job.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="text-sm font-medium text-zima-text-primary mb-1">{job.name}</h3>
                        <p className="text-xs text-zima-text-secondary mb-2">
                          {job.sourcePath} → {job.targetShare.displayName}
                        </p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleRunJob(job.id)}
                          disabled={isRunning}
                          className="bg-zima-blue hover:bg-blue-600 text-white rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isRunning ? 'Running...' : 'Run'}
                        </button>
                        <button
                          onClick={() => handleDeleteJob(job.id)}
                          disabled={isRunning}
                          className="bg-red-500 hover:bg-red-600 text-white rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {/* Progress indicator */}
                    {progress && progress.status === 'running' && (
                      <div className="mb-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-zima-text-secondary">
                            {progress.filesTransferred} files transferred
                            {progress.bytesTransferred > 0 && ` (${formatBytes(progress.bytesTransferred)})`}
                          </span>
                          {progress.progress > 0 && (
                            <span className="text-xs text-zima-text-secondary">{progress.progress}%</span>
                          )}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                          {progress.progress > 0 ? (
                            <div
                              className="bg-zima-blue h-2 rounded-full transition-all duration-300"
                              style={{ width: `${progress.progress}%` }}
                            ></div>
                          ) : (
                            <div className="relative w-full h-2 overflow-hidden">
                              <div className="absolute inset-0 bg-zima-blue opacity-30"></div>
                              <div className="absolute h-2 bg-zima-blue w-1/3 animate-pulse"></div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-zima-text-secondary">
                          <div className="flex items-center gap-3">
                            {progress.speed && progress.speed > 0 && (
                              <span>{formatSpeed(progress.speed)}</span>
                            )}
                            {progress.elapsedTime !== undefined && (
                              <span>Elapsed: {formatTime(progress.elapsedTime)}</span>
                            )}
                            {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 && (
                              <span>ETA: {formatTime(progress.estimatedTimeRemaining)}</span>
                            )}
                          </div>
                        </div>
                        {progress.currentFile && (
                          <p className="text-xs text-zima-text-secondary mt-1 truncate">
                            {progress.currentFile}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Last run info */}
                    {!progress && job.lastRun && (
                      <div>
                        <p className="text-xs text-zima-text-secondary">
                          Last run: {formatDate(job.lastRun)}
                          {job.lastStatus === 'success' && ' ✓'}
                          {job.lastStatus === 'failed' && ' ✗'}
                        </p>
                        {job.stats && (
                          <p className="text-xs text-zima-text-secondary">
                            {job.stats.filesTransferred} files, {formatBytes(job.stats.bytesTransferred)}
                          </p>
                        )}
                        {job.lastError && (
                          <p className="text-xs text-red-500 mt-1">Error: {job.lastError}</p>
                        )}
                      </div>
                    )}

                    {/* Completion message */}
                    {progress && progress.status === 'completed' && (
                      <div className="flex items-center gap-2 text-green-600">
                        <span className="text-xs">✓ Backup completed!</span>
                        <span className="text-xs text-zima-text-secondary">
                          {progress.filesTransferred} files, {formatBytes(progress.bytesTransferred)}
                        </span>
                      </div>
                    )}

                    {/* Error message */}
                    {progress && progress.status === 'failed' && (
                      <div className="text-red-500">
                        <p className="text-xs">✗ Backup failed</p>
                        {progress.error && <p className="text-xs mt-1">{progress.error}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showAddDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-zima-text-primary">Add backup folder</h2>
                <button
                  onClick={() => {
                    setShowAddDialog(false);
                    setSelectedFolder(null);
                    setSelectedShare(null);
                    setSpace(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${selectedFolder ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {selectedFolder ? '✓' : <span className="w-3 h-3 bg-white rounded-full"></span>}
                  </div>
                  <p className="text-sm font-medium text-zima-text-primary">Select folder</p>
                </div>

                <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 flex items-center justify-center">
                  {selectedFolder ? (
                    <div className="text-center w-full">
                      <p className="text-sm text-zima-text-primary font-medium mb-2 break-all">{selectedFolder}</p>
                      <button onClick={handleSelectFolder} className="text-xs text-zima-blue hover:underline">
                        Change
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleSelectFolder}
                      className="bg-zima-blue hover:bg-blue-600 text-white rounded-full px-6 py-2 text-sm font-medium transition-colors"
                    >
                      Select
                    </button>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${selectedShare ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {selectedShare ? '✓' : <span className="w-3 h-3 bg-white rounded-full"></span>}
                  </div>
                  <p className="text-sm font-medium">To <span className="text-zima-blue">Zima</span></p>
                </div>

                {selectedShare ? (
                  <div className="border border-gray-300 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <input
                        type="text"
                        value={targetPath}
                        onChange={(e) => setTargetPath(e.target.value)}
                        placeholder="/Backup"
                        className="flex-1 text-sm text-zima-text-primary bg-transparent border-none outline-none"
                      />
                      <button onClick={() => setSelectedShare(null)} className="text-xs text-zima-blue hover:underline ml-2">
                        Change
                      </button>
                    </div>
                    {loadingSpace ? (
                      <p className="text-xs text-zima-text-secondary">Loading space info...</p>
                    ) : space ? (
                      <p className="text-xs text-zima-text-secondary">Available {formatBytes(space.available)}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="border border-gray-300 rounded-xl p-3">
                    <select
                      onChange={(e) => {
                        const share = availableShares.find(s => s.name === e.target.value);
                        if (share) handleSelectShare(share);
                      }}
                      className="w-full text-sm text-zima-text-primary bg-transparent outline-none"
                      defaultValue=""
                      disabled={availableShares.length === 0}
                    >
                      <option value="" disabled>
                        {availableShares.length === 0 ? 'No shares available' : 'Select a share...'}
                      </option>
                      {availableShares.map((share, idx) => (
                        <option key={idx} value={share.name}>
                          {share.displayName}
                        </option>
                      ))}
                    </select>
                    {availableShares.length === 0 && devices.length === 0 && (
                      <p className="text-xs text-zima-text-secondary mt-2">
                        No devices connected. Connect to a ZimaOS device first.
                      </p>
                    )}
                    {availableShares.length === 0 && devices.length > 0 && (
                      <p className="text-xs text-zima-text-secondary mt-2">
                        No shares found on connected devices.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleCreateJob}
                disabled={!selectedFolder || !selectedShare}
                className="w-full bg-zima-blue hover:bg-blue-600 text-white rounded-full py-3 px-6 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
