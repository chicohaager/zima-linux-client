import React from 'react';
import { useAppStore } from '../store';
import { DeviceCard } from '../components/DeviceCard';

export const DevicesPage: React.FC = () => {
  const { devices, setSelectedDevice, setCurrentView } = useAppStore();

  const handleSelectDevice = (device: any) => {
    setSelectedDevice(device);
    setCurrentView('apps');
  };

  return (
    <div className="min-h-screen bg-zima-dark text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Available Devices</h1>

        {devices.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-xl mb-6">No devices found</p>
            <button
              onClick={() => setCurrentView('connect')}
              className="px-6 py-3 bg-zima-blue hover:bg-blue-600 rounded-lg font-semibold transition-colors"
            >
              Scan Again
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onSelect={() => handleSelectDevice(device)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
