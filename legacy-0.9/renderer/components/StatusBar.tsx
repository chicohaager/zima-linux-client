import React, { memo } from 'react';
import { useAppStore } from '../store';
import iconGif from '../assets/icon.gif';
import { HeartIcon } from './Icons';

export const StatusBar: React.FC = memo(() => {
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const selectedDevice = useAppStore((state) => state.selectedDevice);

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex flex-col items-center">
        {/* Logo */}
        <img
          src={iconGif}
          alt="Remote Connect"
          className="w-16 h-16 mb-3"
        />

        {/* Title */}
        <h1 className="text-xl font-bold text-zima-text-primary mb-1">
          Remote Connect
        </h1>

        {/* Subtitle */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 text-xs text-zima-text-secondary">
            <span>Community Edition with</span>
            <HeartIcon className="text-red-500 w-2 h-2" />
            <span>by Lintuxer</span>
          </div>
          <span
            onClick={() => window.electron.app.open('https://discord.com/channels/884667213326463016/1251135390203777124')}
            className="text-xs text-zima-blue hover:underline font-medium flex items-center gap-1 cursor-pointer"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515a.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0a12.64 12.64 0 00-.617-1.25a.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057a19.9 19.9 0 005.993 3.03a.078.078 0 00.084-.028a14.09 14.09 0 001.226-1.994a.076.076 0 00-.041-.106a13.107 13.107 0 01-1.872-.892a.077.077 0 01-.008-.128a10.2 10.2 0 00.372-.292a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127a12.299 12.299 0 01-1.873.892a.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028a19.839 19.839 0 006.002-3.03a.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            Community Discussions
          </span>
        </div>

        {/* Connection Status */}
        {connectionStatus.connected && selectedDevice && (
          <div className="flex items-center gap-2 mt-3 px-3 py-1.5 bg-green-50 rounded-full">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            <span className="text-xs text-green-700 font-medium">
              Connected to {selectedDevice.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
