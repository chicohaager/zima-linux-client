import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { ZeroTierDiagnosticsView } from '../components/ZeroTierDiagnosticsView';

/**
 * Settings page component
 * Manages app configuration including language, theme, ZeroTier, and backup settings
 */
export const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'general' | 'zerotier' | 'backup' | 'about'>('general');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [zerotierAutoStart, setZerotierAutoStart] = useState(false);
  const [backupNotifications, setBackupNotifications] = useState(true);

  // Update state
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'uptodate'>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; error?: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Listen for update events
  useEffect(() => {
    const unsubAvailable = window.electron.update.onUpdateAvailable((info) => {
      setUpdateStatus('available');
      setUpdateInfo({ version: info.version });
    });

    const unsubNotAvailable = window.electron.update.onUpdateNotAvailable(() => {
      setUpdateStatus('uptodate');
      setUpdateInfo(null);
    });

    const unsubProgress = window.electron.update.onDownloadProgress((progress) => {
      setUpdateStatus('downloading');
      setDownloadProgress(progress.percent || 0);
    });

    const unsubDownloaded = window.electron.update.onUpdateDownloaded((info) => {
      setUpdateStatus('ready');
      setUpdateInfo({ version: info.version });
    });

    const unsubError = window.electron.update.onUpdateError((error) => {
      setUpdateStatus('error');
      setUpdateInfo({ error });
    });

    return () => {
      unsubAvailable();
      unsubNotAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateInfo(null);

    // Set a timeout - if no response in 15 seconds, show error
    const timeoutId = setTimeout(() => {
      setUpdateStatus((current) => {
        if (current === 'checking') {
          setUpdateInfo({ error: 'Update-Server nicht erreichbar (Timeout)' });
          return 'error';
        }
        return current;
      });
    }, 15000);

    try {
      await window.electron.update.check();
      // Note: The actual status update comes from the event listeners
    } catch (error) {
      clearTimeout(timeoutId);
      setUpdateStatus('error');
      setUpdateInfo({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('downloading');
    setDownloadProgress(0);
    await window.electron.update.download();
  };

  const handleInstallUpdate = async () => {
    await window.electron.update.install();
  };

  const tabs = [
    { id: 'general' as const, label: t('settings.general.title'), icon: '⚙️' },
    { id: 'zerotier' as const, label: t('settings.zerotier.title'), icon: '🌐' },
    { id: 'backup' as const, label: t('settings.backup.title'), icon: '💾' },
    { id: 'about' as const, label: t('settings.about.title'), icon: 'ℹ️' },
  ];

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    // Apply theme to document
    if (newTheme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', isDark);
    } else {
      document.documentElement.classList.toggle('dark', newTheme === 'dark');
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-gray-900 dark:text-white">{t('settings.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400" />
            )}
          </button>
        ))}
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.general.language')}
            </h2>
            <LanguageSwitcher />
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.general.theme')}
            </h2>
            <div className="flex gap-3">
              {(['light', 'dark', 'system'] as const).map((themeOption) => (
                <button
                  key={themeOption}
                  onClick={() => handleThemeChange(themeOption)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    theme === themeOption
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {t(`settings.general.${themeOption}`)}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ZeroTier Settings */}
      {activeTab === 'zerotier' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {t('settings.zerotier.autoStart')}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Automatically start ZeroTier when the app launches
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={zerotierAutoStart}
                  onChange={(e) => setZerotierAutoStart(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.zerotier.networkId')}
            </h2>
            <input
              type="text"
              placeholder="1234567890abcdef"
              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Default network to join on startup
            </p>
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.zerotier.diagnostics') || 'Diagnostics'}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Run system checks to troubleshoot ZeroTier connectivity issues
            </p>
            <ZeroTierDiagnosticsView />
          </section>
        </div>
      )}

      {/* Backup Settings */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {t('settings.backup.notifications')}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Show system notifications for backup job status
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={backupNotifications}
                  onChange={(e) => setBackupNotifications(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.backup.logLevel')}
            </h2>
            <select className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="error">Error</option>
              <option value="warn">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </section>
        </div>
      )}

      {/* About */}
      {activeTab === 'about' && (
        <div className="space-y-6">
          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-blue-500 rounded-lg flex items-center justify-center text-3xl">
                🖥️
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">ZimaOS Client</h2>
                <p className="text-gray-600 dark:text-gray-400">Desktop client for ZimaOS</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.about.version')}
                </span>
                <span className="text-gray-900 dark:text-white">0.9.21</span>
              </div>

              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.about.license')}
                </span>
                <span className="text-gray-900 dark:text-white">MIT</span>
              </div>

              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.about.repository')}
                </span>
                <a
                  href="https://github.com/chicohaager/zima-linux-client"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  GitHub
                </a>
              </div>
            </div>

            <button
              onClick={() => window.electron.openExternal('https://github.com/chicohaager/zima-linux-client/issues/new')}
              className="mt-6 w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
            >
              {t('settings.about.reportIssue')}
            </button>
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">
              {t('settings.about.updates')}
            </h2>

            {/* Idle state - show check button */}
            {(updateStatus === 'idle' || updateStatus === 'uptodate') && (
              <div className="space-y-3">
                {updateStatus === 'uptodate' && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-3">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{t('settings.about.upToDate')}</span>
                  </div>
                )}
                <button
                  onClick={handleCheckForUpdates}
                  className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                >
                  {t('settings.about.checkForUpdates')}
                </button>
              </div>
            )}

            {/* Checking state */}
            {updateStatus === 'checking' && (
              <div className="flex items-center gap-3 text-gray-600 dark:text-gray-400">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{t('settings.about.checkingForUpdates')}</span>
              </div>
            )}

            {/* Update available */}
            {updateStatus === 'available' && updateInfo?.version && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{t('settings.about.updateAvailable')}: v{updateInfo.version}</span>
                </div>
                <button
                  onClick={handleDownloadUpdate}
                  className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
                >
                  {t('settings.about.downloadUpdate')}
                </button>
              </div>
            )}

            {/* Downloading */}
            {updateStatus === 'downloading' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-gray-700 dark:text-gray-300">
                  <span>{t('settings.about.downloading')}</span>
                  <span>{Math.round(downloadProgress)}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                  <div
                    className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Ready to install */}
            {updateStatus === 'ready' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{t('settings.about.updateReady')}{updateInfo?.version ? ` (v${updateInfo.version})` : ''}</span>
                </div>
                <button
                  onClick={handleInstallUpdate}
                  className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
                >
                  {t('settings.about.installAndRestart')}
                </button>
              </div>
            )}

            {/* Error state */}
            {updateStatus === 'error' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{t('settings.about.updateError')}</span>
                </div>
                {updateInfo?.error && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{updateInfo.error}</p>
                )}
                <button
                  onClick={handleCheckForUpdates}
                  className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                >
                  {t('settings.about.tryAgain')}
                </button>
              </div>
            )}
          </section>

          <section className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-white">Technologies</h3>
            <div className="flex flex-wrap gap-2">
              {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'ZeroTier', 'Winston', 'Jest'].map((tech) => (
                <span
                  key={tech}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-sm"
                >
                  {tech}
                </span>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
