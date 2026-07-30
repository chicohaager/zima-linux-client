import { ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { ZeroTierManager } from '../zerotier/manager';
import { runZeroTierDiagnostics } from '../zerotierDiagnostics';

export function registerZeroTierHandlers(zerotierManager: ZeroTierManager): void {
  ipcMain.handle('zerotier:start', async () => {
    try {
      await zerotierManager.start();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:stop', async () => {
    try {
      await zerotierManager.stop();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:join', async (_event, networkId: string) => {
    try {
      // Ensure ZeroTier daemon is running before attempting to join
      const ready = await zerotierManager.isReady();
      if (!ready) {
        logger.info('ZeroTier daemon not running, starting it first...');
        await zerotierManager.start();
      }

      const result = await zerotierManager.joinNetwork(networkId);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:leave', async (_event, networkId: string) => {
    try {
      await zerotierManager.leaveNetwork(networkId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:listNetworks', async () => {
    try {
      // Return empty array if daemon not running (instead of error)
      const ready = await zerotierManager.isReady();
      if (!ready) {
        return { success: true, data: [] };
      }

      const networks = await zerotierManager.getNetworks();
      return { success: true, data: networks };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:getStatus', async () => {
    try {
      const ready = await zerotierManager.isReady();
      if (!ready) {
        return { success: true, data: { running: false, networks: [] } };
      }

      const networks = await zerotierManager.getNetworks();
      return {
        success: true,
        data: { running: true, networks }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('zerotier:diagnostics', async () => {
    try {
      const diagnostics = await runZeroTierDiagnostics();
      return { success: true, data: diagnostics };
    } catch (error: any) {
      logger.error('Failed to run ZeroTier diagnostics:', error);
      return { success: false, error: error.message };
    }
  });
}
