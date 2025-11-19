import { useState, useCallback } from 'react';
import { ZeroTierNetwork } from '@shared/types';

export const useZeroTier = () => {
  const [networks, setNetworks] = useState<ZeroTierNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startZeroTier = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.start();

      if (!result.success) {
        throw new Error(result.error || 'Failed to start ZeroTier');
      }

      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const stopZeroTier = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.stop();

      if (!result.success) {
        throw new Error(result.error || 'Failed to stop ZeroTier');
      }

      setNetworks([]);
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNetworks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.listNetworks();

      if (!result.success) {
        throw new Error(result.error || 'Failed to list networks');
      }

      setNetworks(result.data || []);
      return result.data || [];
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const joinNetwork = useCallback(async (networkId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.join(networkId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to join network');
      }

      await refreshNetworks();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshNetworks]);

  const leaveNetwork = useCallback(async (networkId: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.zerotier.leave(networkId);

      if (!result.success) {
        throw new Error(result.error || 'Failed to leave network');
      }

      await refreshNetworks();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshNetworks]);

  return {
    networks,
    loading,
    error,
    startZeroTier,
    stopZeroTier,
    joinNetwork,
    leaveNetwork,
    refreshNetworks,
  };
};
