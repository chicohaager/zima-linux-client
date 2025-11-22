import React, { memo, useCallback } from 'react';
import { useAppStore } from '../store';
import { AppsIcon, BackupIcon, DisconnectIcon, HomeIcon, SettingsIcon } from './Icons';

export const Navigation: React.FC = memo(() => {
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const selectedDevice = useAppStore((state) => state.selectedDevice);
  const setSelectedDevice = useAppStore((state) => state.setSelectedDevice);
  const setDevices = useAppStore((state) => state.setDevices);

  const handleDisconnect = useCallback(() => {
    setSelectedDevice(null);
    setDevices([]);
    setCurrentView('connect');
  }, [setSelectedDevice, setDevices, setCurrentView]);

  // Only show navigation when device is selected
  if (!selectedDevice) {
    return null;
  }

  const navItems = [
    {
      id: 'connect' as const,
      label: 'Home',
      icon: (active: boolean) => (
        <HomeIcon className={`${active ? 'text-white' : 'text-gray-200'} w-7 h-7`} />
      )
    },
    {
      id: 'apps' as const,
      label: 'Apps',
      icon: (active: boolean) => (
        <AppsIcon className={`${active ? 'text-white' : 'text-gray-200'} w-7 h-7`} />
      )
    },
    {
      id: 'backup' as const,
      label: 'Backup',
      icon: (active: boolean) => (
        <BackupIcon className={`${active ? 'text-white' : 'text-gray-200'} w-7 h-7`} />
      )
    },
    {
      id: 'settings' as const,
      label: 'Settings',
      icon: (active: boolean) => (
        <SettingsIcon className={`${active ? 'text-white' : 'text-gray-200'} w-7 h-7`} />
      )
    }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-center pb-8 px-4 pointer-events-none">
      <div className="bg-gray-900 rounded-2xl shadow-2xl flex items-center gap-3 px-6 py-4 pointer-events-auto border-2 border-gray-700">
        {/* Disconnect Button */}
        <button
          onClick={handleDisconnect}
          className="p-4 rounded-xl hover:bg-gray-700 transition-colors group relative"
          title="Disconnect"
        >
          <DisconnectIcon className="text-gray-200 w-7 h-7" />
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Disconnect
          </span>
        </button>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-700"></div>

        {/* Home */}
        <button
          onClick={() => setCurrentView('connect')}
          className={`p-4 rounded-xl transition-colors group relative ${
            currentView === 'connect' ? 'bg-zima-blue text-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[0].icon(currentView === 'connect')}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {navItems[0].label}
          </span>
        </button>

        {/* Apps */}
        <button
          onClick={() => setCurrentView('apps')}
          className={`p-4 rounded-xl transition-colors group relative ${
            currentView === 'apps' ? 'bg-zima-blue text-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[1].icon(currentView === 'apps')}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {navItems[1].label}
          </span>
        </button>

        {/* Backup */}
        <button
          onClick={() => setCurrentView('backup')}
          className={`p-4 rounded-xl transition-colors group relative ${
            currentView === 'backup' ? 'bg-zima-blue text-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[2].icon(currentView === 'backup')}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {navItems[2].label}
          </span>
        </button>

        {/* Settings */}
        <button
          onClick={() => setCurrentView('settings')}
          className={`p-4 rounded-xl transition-colors group relative ${
            currentView === 'settings' ? 'bg-zima-blue text-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[3].icon(currentView === 'settings')}
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 bg-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            {navItems[3].label}
          </span>
        </button>
      </div>
    </nav>
  );
});
