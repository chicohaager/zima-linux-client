import React from 'react';
import { useAppStore } from '../store';

export const Navigation: React.FC = () => {
  const { currentView, setCurrentView, selectedDevice, setSelectedDevice, setDevices } = useAppStore();

  const handleDisconnect = () => {
    setSelectedDevice(null);
    setDevices([]);
    setCurrentView('connect');
  };

  // Only show navigation when device is selected
  if (!selectedDevice) {
    return null;
  }

  const navItems = [
    {
      id: 'apps' as const,
      label: 'Apps',
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-white' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    },
    {
      id: 'backup' as const,
      label: 'Backup',
      icon: (active: boolean) => (
        <svg className={`w-6 h-6 ${active ? 'text-white' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      )
    }
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-center pb-6 px-4 pointer-events-none">
      <div className="bg-zima-nav-bg rounded-full shadow-2xl flex items-center gap-1 px-3 py-2 pointer-events-auto">
        {/* Disconnect Button */}
        <button
          onClick={handleDisconnect}
          className="p-3 rounded-full hover:bg-gray-700 transition-colors"
          title="Disconnect"
        >
          <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>

        {/* Apps */}
        <button
          onClick={() => setCurrentView('apps')}
          className={`p-3 rounded-full transition-colors ${
            currentView === 'apps' ? 'bg-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[0].icon(currentView === 'apps')}
        </button>

        {/* Backup */}
        <button
          onClick={() => setCurrentView('backup')}
          className={`p-3 rounded-full transition-colors ${
            currentView === 'backup' ? 'bg-white' : 'hover:bg-gray-700'
          }`}
        >
          {navItems[1].icon(currentView === 'backup')}
        </button>
      </div>
    </nav>
  );
};
