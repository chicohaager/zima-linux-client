import React from 'react';
import { useAppStore } from '../store';
import iconGif from '../assets/icon.gif';

export const StatusBar: React.FC = () => {
  const { connectionStatus, selectedDevice } = useAppStore();

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
        <div className="flex items-center gap-1 text-xs text-zima-text-secondary">
          <span>Community Edition with</span>
          <svg className="w-3 h-3 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
          </svg>
          <span>by Lintuxer</span>
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
};
