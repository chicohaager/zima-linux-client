import * as keytar from 'keytar';
import { logger } from '../utils/logger';

/**
 * Secure Credentials Manager using system keychain
 * Stores passwords securely using keytar (libsecret on Linux)
 */
export class CredentialsManager {
  private readonly SERVICE_NAME = 'zima-client';

  /**
   * Store credentials securely in system keychain
   * @param key Unique identifier (e.g., "backup-job-123" or "smb-share-host-sharename")
   * @param username Username to store
   * @param password Password to store
   */
  async setCredentials(key: string, username: string, password: string): Promise<void> {
    try {
      // Store username and password together as JSON
      const credentials = JSON.stringify({ username, password });
      await keytar.setPassword(this.SERVICE_NAME, key, credentials);
      logger.info(`[Credentials] Stored credentials for: ${key}`);
    } catch (error) {
      logger.error(`[Credentials] Failed to store credentials for ${key}:`, error);
      throw new Error(`Failed to store credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieve credentials from system keychain
   * @param key Unique identifier
   * @returns Credentials or null if not found
   */
  async getCredentials(key: string): Promise<{ username: string; password: string } | null> {
    try {
      const credentialsJson = await keytar.getPassword(this.SERVICE_NAME, key);

      if (!credentialsJson) {
        return null;
      }

      const credentials = JSON.parse(credentialsJson);
      return {
        username: credentials.username,
        password: credentials.password
      };
    } catch (error) {
      logger.error(`[Credentials] Failed to retrieve credentials for ${key}:`, error);
      return null;
    }
  }

  /**
   * Delete credentials from system keychain
   * @param key Unique identifier
   */
  async deleteCredentials(key: string): Promise<boolean> {
    try {
      const result = await keytar.deletePassword(this.SERVICE_NAME, key);
      if (result) {
        logger.info(`[Credentials] Deleted credentials for: ${key}`);
      }
      return result;
    } catch (error) {
      logger.error(`[Credentials] Failed to delete credentials for ${key}:`, error);
      return false;
    }
  }

  /**
   * Check if credentials exist for a key
   * @param key Unique identifier
   */
  async hasCredentials(key: string): Promise<boolean> {
    try {
      const credentials = await keytar.getPassword(this.SERVICE_NAME, key);
      return credentials !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * List all stored credential keys
   * Useful for migration or cleanup
   */
  async listCredentialKeys(): Promise<string[]> {
    try {
      const credentials = await keytar.findCredentials(this.SERVICE_NAME);
      return credentials.map(cred => cred.account);
    } catch (error) {
      logger.error('[Credentials] Failed to list credentials:', error);
      return [];
    }
  }

  /**
   * Migrate plaintext credentials to secure storage
   * Used for upgrading from old insecure storage
   */
  async migrateFromPlaintext(
    key: string,
    plaintextCredentials: { username: string; password: string }
  ): Promise<void> {
    await this.setCredentials(key, plaintextCredentials.username, plaintextCredentials.password);
    logger.info(`[Credentials] Migrated credentials for: ${key}`);
  }

  /**
   * Clear all credentials for this service
   * Use with caution - for debugging or complete reset
   */
  async clearAllCredentials(): Promise<void> {
    try {
      const keys = await this.listCredentialKeys();
      for (const key of keys) {
        await this.deleteCredentials(key);
      }
      logger.info(`[Credentials] Cleared all ${keys.length} credentials`);
    } catch (error) {
      logger.error('[Credentials] Failed to clear credentials:', error);
      throw error;
    }
  }
}

// Singleton instance
export const credentialsManager = new CredentialsManager();
