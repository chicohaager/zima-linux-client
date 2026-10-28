import { createHash } from 'node:crypto'

/**
 * The Remote ID (= ZeroTier network id, 16 hex) is the key to the device's network, and it
 * reached the log in `zerotier.joined`, `zerotier.left` and every error text quoting it.
 * Replaced by a short hash: lines about the same network stay comparable, the id does not
 * leave. Exactly 16 — a sha256 contains 16-hex runs and must survive.
 *
 * One function for new lines (logger.ts) and old files (redactLogFiles.ts), so a line
 * written before 2.0.7 and one written after carry the same mask for the same network.
 */
const REMOTE_ID = /(?<![0-9a-fA-F])[0-9a-fA-F]{16}(?![0-9a-fA-F])/g

export const redact = (text: string): string =>
  text.replace(REMOTE_ID, (id) =>
    `<remote-id:${createHash('sha256').update(id.toLowerCase()).digest('hex').slice(0, 8)}>`,
  )
