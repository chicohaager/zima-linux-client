import React, { useState } from 'react';
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
                <span className="text-gray-900 dark:text-white">0.9.8</span>
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
            <h3 className="font-semibold mb-2 text-gray-900 dark:text-white">Technologies</h3>
            <div className="flex flex-wrap gap-2">
              {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'ZeroTier', 'Winston', 'Jest', 'Sentry'].map((tech) => (
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
