/**
 * Tests for CredentialsManager
 * Critical security component - tests for encryption, storage, and retrieval
 */

import { CredentialsManager } from '../credentials';

// Mock keytar
jest.mock('keytar', () => ({
  setPassword: jest.fn(),
  getPassword: jest.fn(),
  deletePassword: jest.fn(),
  findCredentials: jest.fn(),
}));

import * as keytar from 'keytar';

describe('CredentialsManager', () => {
  let manager: CredentialsManager;

  beforeEach(() => {
    manager = new CredentialsManager();
    jest.clearAllMocks();
  });

  describe('setCredentials', () => {
    it('should store credentials securely', async () => {
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);

      await manager.setCredentials('test-key', 'testuser', 'testpass');

      expect(keytar.setPassword).toHaveBeenCalledWith(
        'zima-client',
        'test-key',
        JSON.stringify({ username: 'testuser', password: 'testpass' })
      );
    });

    it('should handle storage errors', async () => {
      (keytar.setPassword as jest.Mock).mockRejectedValue(new Error('Storage failed'));

      await expect(
        manager.setCredentials('test-key', 'testuser', 'testpass')
      ).rejects.toThrow('Failed to store credentials');
    });

    it('should store special characters in passwords', async () => {
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);

      const specialPassword = 'p@ss!w0rd#$%^&*()_+-=[]{}|;:,.<>?/~`';
      await manager.setCredentials('test-key', 'testuser', specialPassword);

      expect(keytar.setPassword).toHaveBeenCalledWith(
        'zima-client',
        'test-key',
        JSON.stringify({ username: 'testuser', password: specialPassword })
      );
    });

    it('should store empty passwords', async () => {
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);

      await manager.setCredentials('test-key', 'testuser', '');

      expect(keytar.setPassword).toHaveBeenCalledWith(
        'zima-client',
        'test-key',
        JSON.stringify({ username: 'testuser', password: '' })
      );
    });
  });

  describe('getCredentials', () => {
    it('should retrieve stored credentials', async () => {
      const storedCreds = JSON.stringify({ username: 'testuser', password: 'testpass' });
      (keytar.getPassword as jest.Mock).mockResolvedValue(storedCreds);

      const result = await manager.getCredentials('test-key');

      expect(result).toEqual({ username: 'testuser', password: 'testpass' });
      expect(keytar.getPassword).toHaveBeenCalledWith('zima-client', 'test-key');
    });

    it('should return null when credentials not found', async () => {
      (keytar.getPassword as jest.Mock).mockResolvedValue(null);

      const result = await manager.getCredentials('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', async () => {
      (keytar.getPassword as jest.Mock).mockResolvedValue('invalid-json');

      const result = await manager.getCredentials('test-key');

      expect(result).toBeNull();
    });

    it('should handle retrieval errors', async () => {
      (keytar.getPassword as jest.Mock).mockRejectedValue(new Error('Retrieval failed'));

      const result = await manager.getCredentials('test-key');

      expect(result).toBeNull();
    });

    it('should retrieve special characters correctly', async () => {
      const specialPassword = 'p@ss!w0rd#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const storedCreds = JSON.stringify({ username: 'testuser', password: specialPassword });
      (keytar.getPassword as jest.Mock).mockResolvedValue(storedCreds);

      const result = await manager.getCredentials('test-key');

      expect(result?.password).toBe(specialPassword);
    });
  });

  describe('deleteCredentials', () => {
    it('should delete credentials successfully', async () => {
      (keytar.deletePassword as jest.Mock).mockResolvedValue(true);

      const result = await manager.deleteCredentials('test-key');

      expect(result).toBe(true);
      expect(keytar.deletePassword).toHaveBeenCalledWith('zima-client', 'test-key');
    });

    it('should return false when credentials not found', async () => {
      (keytar.deletePassword as jest.Mock).mockResolvedValue(false);

      const result = await manager.deleteCredentials('nonexistent-key');

      expect(result).toBe(false);
    });

    it('should handle deletion errors', async () => {
      (keytar.deletePassword as jest.Mock).mockRejectedValue(new Error('Deletion failed'));

      const result = await manager.deleteCredentials('test-key');

      expect(result).toBe(false);
    });
  });

  describe('hasCredentials', () => {
    it('should return true when credentials exist', async () => {
      const storedCreds = JSON.stringify({ username: 'testuser', password: 'testpass' });
      (keytar.getPassword as jest.Mock).mockResolvedValue(storedCreds);

      const result = await manager.hasCredentials('test-key');

      expect(result).toBe(true);
    });

    it('should return false when credentials do not exist', async () => {
      (keytar.getPassword as jest.Mock).mockResolvedValue(null);

      const result = await manager.hasCredentials('nonexistent-key');

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      (keytar.getPassword as jest.Mock).mockRejectedValue(new Error('Check failed'));

      const result = await manager.hasCredentials('test-key');

      expect(result).toBe(false);
    });
  });

  describe('listCredentialKeys', () => {
    it('should list all credential keys', async () => {
      (keytar.findCredentials as jest.Mock).mockResolvedValue([
        { account: 'backup-job-1', password: '{}' },
        { account: 'backup-job-2', password: '{}' },
        { account: 'smb-share-1', password: '{}' },
      ]);

      const result = await manager.listCredentialKeys();

      expect(result).toEqual(['backup-job-1', 'backup-job-2', 'smb-share-1']);
    });

    it('should return empty array when no credentials exist', async () => {
      (keytar.findCredentials as jest.Mock).mockResolvedValue([]);

      const result = await manager.listCredentialKeys();

      expect(result).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      (keytar.findCredentials as jest.Mock).mockRejectedValue(new Error('List failed'));

      const result = await manager.listCredentialKeys();

      expect(result).toEqual([]);
    });
  });

  describe('migrateFromPlaintext', () => {
    it('should migrate plaintext credentials to secure storage', async () => {
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);

      await manager.migrateFromPlaintext('test-key', {
        username: 'olduser',
        password: 'oldpass',
      });

      expect(keytar.setPassword).toHaveBeenCalledWith(
        'zima-client',
        'test-key',
        JSON.stringify({ username: 'olduser', password: 'oldpass' })
      );
    });
  });

  describe('clearAllCredentials', () => {
    it('should clear all credentials', async () => {
      (keytar.findCredentials as jest.Mock).mockResolvedValue([
        { account: 'key1', password: '{}' },
        { account: 'key2', password: '{}' },
      ]);
      (keytar.deletePassword as jest.Mock).mockResolvedValue(true);

      await manager.clearAllCredentials();

      expect(keytar.deletePassword).toHaveBeenCalledTimes(2);
      expect(keytar.deletePassword).toHaveBeenCalledWith('zima-client', 'key1');
      expect(keytar.deletePassword).toHaveBeenCalledWith('zima-client', 'key2');
    });

    it('should handle errors during clear gracefully', async () => {
      // When listCredentialKeys fails, it returns empty array and logs error
      (keytar.findCredentials as jest.Mock).mockRejectedValue(new Error('List failed'));

      // clearAllCredentials should succeed with 0 deletions
      await expect(manager.clearAllCredentials()).resolves.toBeUndefined();
    });
  });

  describe('Integration scenarios', () => {
    it('should handle full lifecycle: set -> get -> delete', async () => {
      const credentials = { username: 'testuser', password: 'testpass' };
      const storedCreds = JSON.stringify(credentials);

      // Set
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);
      await manager.setCredentials('lifecycle-key', credentials.username, credentials.password);

      // Get
      (keytar.getPassword as jest.Mock).mockResolvedValue(storedCreds);
      const retrieved = await manager.getCredentials('lifecycle-key');
      expect(retrieved).toEqual(credentials);

      // Delete
      (keytar.deletePassword as jest.Mock).mockResolvedValue(true);
      const deleted = await manager.deleteCredentials('lifecycle-key');
      expect(deleted).toBe(true);

      // Verify deleted
      (keytar.getPassword as jest.Mock).mockResolvedValue(null);
      const afterDelete = await manager.getCredentials('lifecycle-key');
      expect(afterDelete).toBeNull();
    });

    it('should handle multiple credentials with different keys', async () => {
      (keytar.setPassword as jest.Mock).mockResolvedValue(undefined);

      await manager.setCredentials('backup-1', 'user1', 'pass1');
      await manager.setCredentials('backup-2', 'user2', 'pass2');
      await manager.setCredentials('smb-1', 'user3', 'pass3');

      expect(keytar.setPassword).toHaveBeenCalledTimes(3);
      expect(keytar.setPassword).toHaveBeenNthCalledWith(
        1,
        'zima-client',
        'backup-1',
        JSON.stringify({ username: 'user1', password: 'pass1' })
      );
      expect(keytar.setPassword).toHaveBeenNthCalledWith(
        2,
        'zima-client',
        'backup-2',
        JSON.stringify({ username: 'user2', password: 'pass2' })
      );
      expect(keytar.setPassword).toHaveBeenNthCalledWith(
        3,
        'zima-client',
        'smb-1',
        JSON.stringify({ username: 'user3', password: 'pass3' })
      );
    });
  });
});
