import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { appError, err, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import { readStatus } from './store'

/**
 * Stores the refresh token per device — and refuses to do so silently when the system
 * cannot actually protect it.
 *
 * Electron's safeStorage keeps "working" without a keyring: it then encrypts with a
 * hardcoded plaintext password and reports the backend as `basic_text`. A fallback that
 * passes the check hides the problem instead of making it harmless, so writing is
 * blocked unless the user has explicitly accepted the risk for this machine.
 *
 * Only the refresh token is persisted, never the password: with a stored password a
 * leak grants permanent access, whereas a refresh token expires (~7 days, measured) and
 * can be revoked by signing out on the device.
 */

const FILE = 'credentials.json'
const CONSENT = 'plaintext-consent'

const filePath = (): string => join(app.getPath('userData'), FILE)
const consentPath = (): string => join(app.getPath('userData'), CONSENT)

interface StoredEntry {
  /** base64 of the safeStorage ciphertext. */
  readonly secret: string
  readonly backend: string
  readonly savedAt: string
}

type Store = Record<string, StoredEntry>

const readStore = (): Store => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath(), 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {}
  } catch {
    // No file yet, or unreadable. An empty store is the correct answer here — it means
    // "nothing saved", which is exactly what a missing file means.
    return {}
  }
}

const writeStore = (store: Store): Result<void> => {
  try {
    mkdirSync(dirname(filePath()), { recursive: true })
    writeFileSync(filePath(), `${JSON.stringify(store, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    return ok(undefined)
  } catch (cause) {
    return err(
      appError('internal', 'could not write the credential store', 'error.internal', undefined, cause),
    )
  }
}

/** Has the user accepted storing secrets on a machine without a keyring? */
export const hasPlaintextConsent = (): boolean => existsSync(consentPath())

export const setPlaintextConsent = (granted: boolean): void => {
  try {
    if (granted) {
      mkdirSync(dirname(consentPath()), { recursive: true })
      writeFileSync(consentPath(), new Date().toISOString(), 'utf8')
    } else {
      rmSync(consentPath(), { force: true })
    }
    logger.warn('secrets.plaintext-consent', { granted })
  } catch (cause) {
    logger.warn('secrets.consent-unwritable', { cause: String(cause) })
  }
}

/**
 * Saves a refresh token for a device.
 *
 * Returns a `plaintext-risk` error instead of writing when the platform has no keyring
 * and no consent was given. The UI turns that into a question; it must never turn into
 * a silent write.
 */
export const saveRefreshToken = (deviceId: string, refreshToken: string): Result<void> => {
  const status = readStatus()

  if (status.plaintextRisk && !hasPlaintextConsent()) {
    logger.warn('secrets.write-refused', { deviceId, backend: status.backend })
    return err(
      appError('plaintext-risk', `refusing to store a secret with backend ${status.backend}`, 'security.keyringPlaintext', {
        backend: status.backend,
      }),
    )
  }

  try {
    const cipher = safeStorage.encryptString(refreshToken)
    const store = readStore()
    store[deviceId] = {
      secret: cipher.toString('base64'),
      backend: status.backend,
      savedAt: new Date().toISOString(),
    }
    return writeStore(store)
  } catch (cause) {
    return err(
      appError('internal', 'safeStorage could not encrypt the secret', 'error.internal', { deviceId }, cause),
    )
  }
}

export const readRefreshToken = (deviceId: string): Result<string | null> => {
  const entry = readStore()[deviceId]
  if (entry === undefined) return ok(null)

  const currentBackend = readStatus().backend
  if (entry.backend !== currentBackend) {
    // The keyring changed since this was written (different desktop, migrated machine).
    // safeStorage cannot decrypt across backends, so say so instead of returning null
    // and letting it look like "never signed in".
    logger.warn('secrets.backend-changed', {
      deviceId,
      storedWith: entry.backend,
      now: currentBackend,
    })
    return err(
      appError('unauthorized', `secret was stored with ${entry.backend}, now ${currentBackend}`, 'security.backendChanged', {
        storedWith: entry.backend,
        now: currentBackend,
      }),
    )
  }

  try {
    return ok(safeStorage.decryptString(Buffer.from(entry.secret, 'base64')))
  } catch (cause) {
    return err(
      appError('unauthorized', 'stored secret could not be decrypted', 'security.backendChanged', { deviceId }, cause),
    )
  }
}

export const forgetRefreshToken = (deviceId: string): Result<void> => {
  const store = readStore()
  if (store[deviceId] === undefined) return ok(undefined)
  delete store[deviceId]
  return writeStore(store)
}
