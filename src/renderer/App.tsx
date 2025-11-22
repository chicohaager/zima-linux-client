import React, { useEffect } from 'react';
import { useAppStore } from './store';
import { Navigation } from './components/Navigation';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { ThemeToggle } from './components/ThemeToggle';
import { ConnectPage } from './pages/Connect';
import { DevicesPage } from './pages/Devices';
import { AppsPage } from './pages/Apps';
import { BackupPage } from './pages/Backup';
import { Settings } from './pages/Settings';

export const App: React.FC = () => {
  const { currentView } = useAppStore();

  useEffect(() => {
    // ZeroTier will be started on-demand when user performs actions
    // No automatic initialization to avoid permission issues
    console.log('ZimaOS Client initialized');
  }, []);

  const renderPage = () => {
    switch (currentView) {
      case 'connect':
        return <ConnectPage />;
      case 'devices':
        return <DevicesPage />;
      case 'apps':
        return <AppsPage />;
      case 'backup':
        return <BackupPage />;
      case 'settings':
        return <Settings />;
      default:
        return <ConnectPage />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 transition-colors">
      {/* Top right controls */}
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={() => useAppStore.getState().setCurrentView(currentView === 'settings' ? 'connect' : 'settings')}
          className={`p-2 rounded-lg transition-colors ${
            currentView === 'settings'
              ? 'bg-blue-500 text-white'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-md'
          }`}
          title={currentView === 'settings' ? 'Back to Home' : 'Settings'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
      <StatusBar />
      <Navigation />
      <main className="page-transition">{renderPage()}</main>
      <Toast />
    </div>
  );
};
