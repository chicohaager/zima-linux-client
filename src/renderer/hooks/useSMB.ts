import { useState, useCallback } from 'react';
import { SMBShare } from '@shared/types';

export const useSMB = () => {
  const [shares, setShares] = useState<SMBShare[]>([]);
  const [pinnedShares, setPinnedShares] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPinnedShares = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.smb.listPinned();

      if (!result.success) {
        throw new Error(result.error || 'Failed to list pinned shares');
      }

      setPinnedShares(result.data || []);
      return result.data || [];
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const discoverShares = useCallback(async (host: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.smb.discoverShares(host);

      if (!result.success) {
        throw new Error(result.error || 'Failed to discover shares');
      }

      setShares(result.data || []);
      return result.data || [];
    } catch (err: any) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const pinShare = useCallback(async (share: SMBShare) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.smb.pinShare(share);

      if (!result.success) {
        throw new Error(result.error || 'Failed to pin share');
      }

      await refreshPinnedShares();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPinnedShares]);

  const unpinShare = useCallback(async (shareUrl: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await window.electron.smb.unpinShare(shareUrl);

      if (!result.success) {
        throw new Error(result.error || 'Failed to unpin share');
      }

      await refreshPinnedShares();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPinnedShares]);

  return {
    shares,
    pinnedShares,
    loading,
    error,
    discoverShares,
    pinShare,
    unpinShare,
    refreshPinnedShares,
  };
};
