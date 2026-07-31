import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ok, type Result } from '@shared/result'
import type { DeviceAddress } from '@shared/domain'
import { logger } from '@main/logging/logger'
import * as registry from '@main/devices/registry'
import { deviceIdFor } from '@main/session'

/**
 * Reading the configuration of the 0.9.x line — Plan § 13.
 *
 * Three rules, all from the migration section of the plan:
 *
 *  - **Read-only.** The old directories are never written to, never moved, never deleted. If
 *    v2 turns out to be a mistake for someone, their old client still works.
 *  - **No secrets.** Passwords and tokens are not migrated. Moving a secret between keyring
 *    backends without the user's knowledge is a silent trust breach, so v2 asks for the
 *    password once instead.
 *  - **Nothing is claimed that was not found.** A profile with an unreadable file is reported
 *    with zero connections, not skipped — "we found nothing" and "we could not read it" look
 *    the same to the user otherwise.
 *
 * The four directory names below are the ones that actually exist on this machine, listed in
 * the plan: `zima-linux-client`, `zima-client`, `zimaos-client`, `zimaos-remote-client`,
 * `zima-remote`.
 */

const LEGACY_DIRECTORIES = [
  'zima-client',
  'zimaos-client',
  'zimaos-remote-client',
  'zima-remote',
] as const

export interface LegacyProfile {
  readonly directory: string
  readonly host: string | null
  readonly username: string | null
  readonly connections: number
  readonly backupJobs: number
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Pulls host-like and user-like strings out of whatever shape an old file had. */
const harvest = (
  value: unknown,
  found: { hosts: string[]; users: string[] },
  depth = 0,
): void => {
  if (depth > 6) return
  if (Array.isArray(value)) {
    for (const entry of value) harvest(entry, found, depth + 1)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.length > 0) {
      const lower = key.toLowerCase()
      if (lower === 'host' || lower === 'ip' || lower === 'address' || lower === 'hostname') {
        found.hosts.push(entry)
      }
      if (lower === 'username' || lower === 'user') found.users.push(entry)
    } else {
      harvest(entry, found, depth + 1)
    }
  }
}

const countEntries = (value: unknown): number => {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'object' && value !== null) return Object.keys(value).length
  return 0
}

/** Finds old profiles. Never throws: a missing directory is the normal case. */
export const scanLegacyProfiles = (): readonly LegacyProfile[] => {
  const base = join(homedir(), '.config')
  const profiles: LegacyProfile[] = []

  for (const name of LEGACY_DIRECTORIES) {
    const directory = join(base, name)
    try {
      if (!statSync(directory).isDirectory()) continue
    } catch {
      continue
    }

    const found = { hosts: [] as string[], users: [] as string[] }
    let connections = 0
    let backupJobs = 0
    let files: string[] = []
    try {
      files = readdirSync(directory).filter((file) => file.endsWith('.json') || file.endsWith('.ini'))
    } catch (cause) {
      logger.warn('legacy.directory-unreadable', { directory, cause: String(cause) })
    }

    for (const file of files) {
      const parsed = readJson(join(directory, file))
      if (parsed === null) continue
      harvest(parsed, found)
      if (file.includes('connection') || file.includes('recent')) connections += countEntries(parsed)
      if (file.includes('backup')) backupJobs += countEntries(parsed)
    }

    profiles.push({
      directory,
      host: found.hosts[0] ?? null,
      username: found.users[0] ?? null,
      connections,
      backupJobs,
    })
  }
  return profiles
}

/**
 * Adopts the hosts of one old profile as devices — addresses only.
 *
 * No credentials come across, so every imported device needs one sign-in. That is the point:
 * the user types their password once and knows why.
 */
export const importProfile = (directory: string): Result<{ imported: number; skipped: number }> => {
  const profile = scanLegacyProfiles().find((candidate) => candidate.directory === directory)
  if (profile === null || profile === undefined) {
    return ok({ imported: 0, skipped: 0 })
  }

  const found = { hosts: [] as string[], users: [] as string[] }
  let files: string[] = []
  try {
    files = readdirSync(directory).filter((file) => file.endsWith('.json'))
  } catch (cause) {
    logger.warn('legacy.directory-unreadable', { directory, cause: String(cause) })
  }
  for (const file of files) {
    const parsed = readJson(join(directory, file))
    if (parsed !== null) harvest(parsed, found)
  }

  let imported = 0
  let skipped = 0
  for (const host of new Set(found.hosts)) {
    const id = deviceIdFor(null, host)
    if (registry.get(id) !== null) {
      // Already known — merging would be harmless but counting it as an import would
      // overstate what happened.
      skipped += 1
      continue
    }
    const address: DeviceAddress = { kind: 'direct', host, port: 80, priority: 0 }
    const stored = registry.upsert({
      id,
      displayName: host,
      addresses: [address],
      // Never seen BY THIS CLIENT. Writing a timestamp here would claim a contact that
      // never happened.
      lastSeenIso: null,
      capabilities: null,
    })
    if (stored.ok) imported += 1
    else skipped += 1
  }

  logger.info('legacy.imported', { directory, imported, skipped })
  return ok({ imported, skipped })
}
