import React, { useEffect } from 'react';
import { useAppStore } from './store';
import { Navigation } from './components/Navigation';
import { StatusBar } from './components/StatusBar';
import { Toast } from './components/Toast';
import { ConnectPage } from './pages/Connect';
import { DevicesPage } from './pages/Devices';
import { AppsPage } from './pages/Apps';
import { BackupPage } from './pages/Backup';

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
      default:
        return <ConnectPage />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-100">
      <StatusBar />
      <Navigation />
      <main className="page-transition">{renderPage()}</main>
      <Toast />
    </div>
  );
};
