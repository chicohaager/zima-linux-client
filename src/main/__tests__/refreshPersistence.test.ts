/*
 * Every refresh token the device hands out must reach the keyring — not only the ones from
 * sign-in and resume.
 *
 * 🔴 Measured 2026-10-08 on ZimaOS 1.8.0-beta2 (.143), with a separate test session:
 *
 *     refresh(R1)                 -> 200, successor R2
 *     refresh(R1) again at 5–25 s -> 200, the SAME R2 (idempotent grace window)
 *     refresh(R1) at 35 s         -> 401
 *     refresh(R2) after that      -> 401   — reuse of R1 revoked the whole family
 *     control: refresh(R2) at 40 s without the replay -> 200
 *
 * The client renewed in-session (every ~3 h) and kept the new token in memory only. The
 * keyring kept the spent one, so the next start presented a token rotated away hours ago:
 * 401, and — had another instance still been running on the successor — that session
 * revoked with it. On resume the new token was saved only after the identity and ZeroTier
 * probes, so a crash in between left the same spent token behind.
 *
 * Real `auth.ts` and `jwt.ts`; only the wire (`request`) and the stores are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Device } from '@shared/domain'

const NOW = 1_800_000_000_000
const sec = (ms: number): number => Math.floor(ms / 1000)
const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const accessJwt = (expMs: number): string =>
  `${b64({ alg: 'ES256', kid: 'k' })}.${b64({ iss: 'zimaos', username: 'owner', role: 'admin', iat: sec(NOW), exp: sec(expMs) })}.sig`

/** Opaque, 43 characters, base64url — the measured form. Values made up. */
const opaque = (n: number): string => `${'r'.repeat(41)}${String(n).padStart(2, '0')}`

const events: string[] = []
let issued = 0
let accessLifetimeMs = 60_000
let rejectRefresh = false

vi.mock('@main/zima/client', () => ({
  request: async (_host: string, _port: number, path: string, opts: { body?: { refresh_token?: string } }) => {
    if (path === '/v1/users/refresh') {
      if (rejectRefresh) {
        events.push('refresh rejected')
        return { ok: false as const, error: { kind: 'unauthorized', message: '20006', i18nKey: 'error.unauthorized' } }
      }
      issued += 1
      events.push(`refresh(${opts.body?.refresh_token ?? ''})->${opaque(issued)}`)
      return {
        ok: true as const,
        value: { access_token: accessJwt(Date.now() + accessLifetimeMs), refresh_token: opaque(issued), expires_at: 0 },
      }
    }
    events.push(`request ${path}`)
    return { ok: false as const, error: { kind: 'timeout', message: 'not measured here', i18nKey: 'error.timeout' } }
  },
  fetchLiveness: async () => ({ ok: true as const, value: {} }),
  fetchRoutes: async () => ({ ok: true as const, value: {} }),
}))

const device: Device = {
  id: 'name:Box',
  displayName: 'Box',
  addresses: [{ kind: 'lan', host: '192.0.2.10', port: 80, priority: 0 }],
  lastSeenIso: '2026-10-08T00:00:00.000Z',
  capabilities: null,
  deviceCode: 'code-1',
} as unknown as Device

vi.mock('@main/devices/registry', () => ({
  get: () => device,
  byPriority: (addresses: unknown[]) => addresses,
  setZerotierState: () => ({ ok: true as const, value: device }),
  setDeviceCode: () => ({ ok: true as const, value: device }),
}))
vi.mock('@main/transport/probe', () => ({
  selectBestAddress: async (addresses: unknown[]) => ({ best: addresses[0], results: [] }),
}))
vi.mock('@main/devices/rediscover', () => ({ learnAddressesFor: async () => ({ learned: [] }) }))
vi.mock('@main/zima/identity', () => ({
  fetchIdentity: async () => {
    events.push('identity')
    return { ok: false as const, error: { kind: 'timeout', message: '', i18nKey: 'error.timeout' } }
  },
}))
vi.mock('@main/zima/capabilities', () => ({
  deriveCapabilities: () => ({}),
  parseRoutes: () => [],
  probeZerotier: async () => {
    events.push('zerotier')
    return { kind: 'unknown' }
  },
}))
vi.mock('@main/zerotier/daemon', () => ({ joinNetwork: async () => ({ ok: true as const, value: undefined }) }))
vi.mock('@main/logging/logger', () => ({
  logger: { info: (): void => {}, warn: (): void => {}, error: (): void => {}, debug: (): void => {} },
}))

let stored: string | null = null
vi.mock('@main/secrets/credentials', () => ({
  readRefreshToken: () => ({ ok: true as const, value: stored }),
  saveRefreshToken: (_id: string, token: string) => {
    events.push(`save(${token})`)
    stored = token
    return { ok: true as const, value: undefined }
  },
}))

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  events.length = 0
  issued = 0
  accessLifetimeMs = 60_000
  rejectRefresh = false
  stored = opaque(0)
})

describe('refresh tokens reach the keyring', () => {
  it('saves the token from an in-session renewal, so the next start does not present a spent one', async () => {
    const session = await import('@main/session')
    expect((await session.resume('name:Box')).ok).toBe(true)
    expect(stored).toBe(opaque(issued))
    const beforeRenewal = issued

    // The access token lives 60 s, inside the 120 s renewal window: this call renews
    // in-session (and so did the ZeroTier probe inside `resume`).
    const access = await session.accessToken()

    expect(access.ok).toBe(true)
    expect(issued).toBe(beforeRenewal + 1)
    // The point: the keyring holds the token the device will accept next — not the one
    // before it, which the device treats as spent and whose replay revokes the family.
    expect(stored).toBe(opaque(issued))
  })

  it('saves the resumed token before anything else can fail', async () => {
    accessLifetimeMs = 3 * 3_600_000
    const session = await import('@main/session')

    await session.resume('name:Box')

    const saved = events.indexOf(`save(${opaque(1)})`)
    expect(saved).toBeGreaterThan(-1)
    expect(saved).toBeLessThan(events.indexOf('zerotier'))
  })

  it('keeps the stored token when an in-session renewal is rejected', async () => {
    const session = await import('@main/session')
    await session.resume('name:Box')
    const before = stored
    rejectRefresh = true

    const access = await session.accessToken()

    expect(access.ok).toBe(false)
    expect(stored).toBe(before)
  })
})
