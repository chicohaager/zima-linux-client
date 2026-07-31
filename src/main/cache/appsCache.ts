import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppTile } from '@shared/domain'
import { logger } from '@main/logging/logger'
import { writePrivateJson } from '@main/storage/privateFile'

/**
 * The offline cache for the app list — Plan § 7.4.
 *
 * The rule that shapes it: **a cache is a proxy signal.** Serving cached tiles as if they
 * were current would show a stopped app as running. So the cache always hands back the
 * timestamp with the data, the UI prints it ("as of 09:14"), and a caller cannot get the
 * tiles without also getting their age — `read()` returns both or neither.
 *
 * Stored per device id: two devices have different apps, and a shared cache would show one
 * device's tiles under the other's name.
 */

const FILE = 'apps-cache.json'
const filePath = (): string => join(app.getPath('userData'), FILE)

interface CacheFile {
  readonly [deviceId: string]: { readonly cachedAtMs: number; readonly apps: readonly AppTile[] }
}

export interface CachedApps {
  readonly apps: readonly AppTile[]
  readonly cachedAtMs: number
}

const readAll = (): CacheFile => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath(), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as CacheFile) : {}
  } catch {
    // No cache yet is the normal first-run state. An unreadable cache is treated the same
    // way — the app list is re-fetched, so nothing is lost and nothing needs a warning.
    return {}
  }
}

export const read = (deviceId: string): CachedApps | null => {
  const entry = readAll()[deviceId]
  if (entry === undefined || !Array.isArray(entry.apps)) return null
  return { apps: entry.apps, cachedAtMs: entry.cachedAtMs }
}

export const write = (deviceId: string, apps: readonly AppTile[]): void => {
  try {
    const all = readAll()
    // 0600: the app list names what runs on the user's device. Not a secret, but not
    // something every local account needs to read either.
    writePrivateJson(filePath(), { ...all, [deviceId]: { cachedAtMs: Date.now(), apps } })
  } catch (cause) {
    // A cache that cannot be written is a degradation, not a failure of the request that
    // triggered it — but it is logged, because "the list is never cached" would otherwise
    // be invisible and look like a slow device.
    logger.warn('apps-cache.unwritable', { cause: String(cause) })
  }
}

export const forget = (deviceId: string): void => {
  try {
    const all = readAll()
    if (all[deviceId] === undefined) return
    const remaining = Object.fromEntries(
      Object.entries(all).filter(([id]) => id !== deviceId),
    )
    writePrivateJson(filePath(), remaining)
  } catch (cause) {
    logger.warn('apps-cache.unremovable', { deviceId, cause: String(cause) })
  }
}
