import { useState, useCallback } from 'react';
import { ZimaDevice } from '@shared/types';

export const useDevices = () => {
  const [devices, setDevices] = useState<ZimaDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanDevices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.device.scan();

      if (!result.success) {
        throw new Error(result.error || 'Failed to scan devices');
      }

      setDevices(result.data || []);
      return result.data || [];
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const connectDevice = useCallback(async (deviceId: string, networkId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.device.connect(deviceId, networkId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect to device');
      }

      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnectDevice = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.device.disconnect();

      if (!result.success) {
        throw new Error(result.error || 'Failed to disconnect device');
      }

      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    devices,
    loading,
    error,
    scanDevices,
    connectDevice,
    disconnectDevice,
  };
};
