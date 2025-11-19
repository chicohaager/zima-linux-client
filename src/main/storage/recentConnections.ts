import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface RecentConnection {
  networkId: string;
  timestamp: number;
  name?: string;
  gatewayIP?: string;
}

/**
 * Manages recently connected ZeroTier networks
 */
export class RecentConnectionsStorage {
  private storageDir: string;
  private storageFile: string;
  private maxConnections: number = 5; // Keep last 5 connections

  constructor() {
    this.storageDir = path.join(app.getPath('home'), '.config/zima-client');
    this.storageFile = path.join(this.storageDir, 'recent-connections.json');
    this.ensureStorageExists();
  }

  /**
   * Ensure storage directory and file exist
   */
  private ensureStorageExists(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.storageFile)) {
      fs.writeFileSync(this.storageFile, JSON.stringify([]), 'utf-8');
    }
  }

  /**
   * Get all recent connections
   */
  getRecent(): RecentConnection[] {
    try {
      const data = fs.readFileSync(this.storageFile, 'utf-8');
      const connections: RecentConnection[] = JSON.parse(data);
      // Sort by timestamp descending (most recent first)
      return connections.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to read recent connections:', error);
      return [];
    }
  }

  /**
   * Save a new connection or update existing one
   */
  saveConnection(connection: Omit<RecentConnection, 'timestamp'>): void {
    try {
      const connections = this.getRecent();

      // Remove existing connection with same networkId
      const filtered = connections.filter(c => c.networkId !== connection.networkId);

      // Add new connection with current timestamp
      const newConnection: RecentConnection = {
        ...connection,
        timestamp: Date.now()
      };

      filtered.unshift(newConnection);

      // Keep only maxConnections most recent
      const trimmed = filtered.slice(0, this.maxConnections);

      fs.writeFileSync(this.storageFile, JSON.stringify(trimmed, null, 2), 'utf-8');
      console.log('Saved recent connection:', connection.networkId);
    } catch (error) {
      console.error('Failed to save recent connection:', error);
    }
  }

  /**
   * Clear all recent connections
   */
  clearAll(): void {
    try {
      fs.writeFileSync(this.storageFile, JSON.stringify([]), 'utf-8');
      console.log('Cleared all recent connections');
    } catch (error) {
      console.error('Failed to clear recent connections:', error);
    }
  }

  /**
   * Remove a specific connection
   */
  removeConnection(networkId: string): void {
    try {
      const connections = this.getRecent();
      const filtered = connections.filter(c => c.networkId !== networkId);
      fs.writeFileSync(this.storageFile, JSON.stringify(filtered, null, 2), 'utf-8');
      console.log('Removed recent connection:', networkId);
    } catch (error) {
      console.error('Failed to remove recent connection:', error);
    }
  }
}
