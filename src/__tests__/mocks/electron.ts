/**
 * Electron mocks for testing
 */

import * as os from 'os';
import * as path from 'path';

const tmpDir = os.tmpdir();

export const app = {
  getPath: jest.fn((name: string) => {
    const paths: Record<string, string> = {
      'home': path.join(tmpDir, 'mock-home'),
      'userData': path.join(tmpDir, 'mock-userData'),
      'temp': tmpDir,
      'appData': path.join(tmpDir, 'mock-appData'),
    };
    return paths[name] || path.join(tmpDir, 'mock-path');
  }),
  isPackaged: false,
  getVersion: jest.fn(() => '0.9.6'),
};

export const dialog = {
  showMessageBox: jest.fn(),
  showOpenDialog: jest.fn(),
  showSaveDialog: jest.fn(),
};

export const ipcMain = {
  handle: jest.fn(),
  on: jest.fn(),
  removeHandler: jest.fn(),
};

export const BrowserWindow = jest.fn();

export const Notification = {
  isSupported: jest.fn(() => false),
};
