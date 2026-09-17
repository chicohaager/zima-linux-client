import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { SecretBackend, SecretStoreStatus } from '@shared/domain'

/**
 * Credential storage on Linux — and the fallback that must never be silent.
 *
 * `keytar` is gone: its repository has been archived since 2022-12-12, and it was a
 * native dependency, which is a portability risk across distros. Electron's own
 * safeStorage replaces it.
 *
 * The catch, straight from Electron's docs: when the system has no secret store,
 * safeStorage still "works" — items are "unprotected as they are encrypted via
 * hardcoded plaintext password", and getSelectedStorageBackend() reports
 * `basic_text`. A fallback that passes the check is worse than one that fails,
 * because it hides the problem instead of making it harmless. So we read the backend
 * and hand the risk to the UI, which must warn before anything is stored.
 */

const BACKENDS: readonly SecretBackend[] = [
  'gnome_libsecret',
  'kwallet',
  'kwallet5',
  'kwallet6',
  'basic_text',
  'unknown',
]

const asBackend = (value: string): SecretBackend =>
  (BACKENDS as readonly string[]).includes(value) ? (value as SecretBackend) : 'unknown'

const CONSENT = 'plaintext-consent'

/** Where "store anyway" is remembered — a file, so it survives restarts and can be removed. */
export const consentPath = (): string => join(app.getPath('userData'), CONSENT)

/** Has the user accepted storing secrets on a machine without a keyring? */
export const hasPlaintextConsent = (): boolean => existsSync(consentPath())

export const readStatus = (): SecretStoreStatus => {
  const encryptionAvailable = safeStorage.isEncryptionAvailable()
  const backend =
    process.platform === 'linux' ? asBackend(safeStorage.getSelectedStorageBackend()) : 'unknown'

  return {
    backend,
    encryptionAvailable,
    // The whole point of this module: say out loud when "encrypted" would be a lie.
    plaintextRisk:
      !encryptionAvailable || backend === 'basic_text' || backend === 'unknown',
    // And say when the user has answered, so the warning can step aside — the status
    // is what the banner renders, and a status that ignores the answer keeps warning.
    plaintextConsent: hasPlaintextConsent(),
  }
}
