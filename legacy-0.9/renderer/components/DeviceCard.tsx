import React from 'react';
import { ZimaDevice } from '@shared/types';

interface DeviceCardProps {
  device: ZimaDevice;
  onSelect: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, onSelect }) => {
  return (
    <div
      onClick={onSelect}
      className="bg-zima-gray rounded-lg p-6 hover:bg-gray-700 cursor-pointer transition-all transform hover:scale-105"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-xl font-semibold mb-1">{device.name}</h3>
          <p className="text-sm text-gray-400">{device.ipAddress}</p>
        </div>
        <div className="flex items-center gap-2">
          {device.online && (
            <span className="w-3 h-3 bg-green-500 rounded-full"></span>
          )}
          <span className={`text-xs px-2 py-1 rounded ${
            device.type === 'local' ? 'bg-blue-600' : 'bg-purple-600'
          }`}>
            {device.type}
          </span>
        </div>
      </div>

      {device.zerotierAddress && (
        <p className="text-xs text-gray-500 mb-3">
          ZeroTier: {device.zerotierAddress}
        </p>
      )}

      {device.shares && device.shares.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-600">
          <p className="text-sm text-gray-400">
            {device.shares.length} share{device.shares.length !== 1 ? 's' : ''} available
          </p>
        </div>
      )}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        className="mt-4 w-full px-4 py-2 bg-zima-blue hover:bg-blue-600 rounded-lg font-semibold transition-colors"
      >
        Connect
      </button>
    </div>
  );
};
