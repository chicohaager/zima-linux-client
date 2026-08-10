/*
 * Recognising a device again at an address nobody stored.
 *
 * Measured 2026-08-10 on a real network; every case below comes from one of those
 * measurements rather than from imagination. Addresses and codes are documentation
 * values (RFC 5737), the shapes and outcomes are the measured ones:
 *
 *   192.0.2.10    device_code 0f3b7c9e-…   ZimaOS     v1.7.0
 *   198.51.100.10   device_code 0f3b7c9e-…   same device, other path
 *   198.51.100.20    device_code 9a8b7c6d-…   different device, v1.6.2
  *   same host after a real reboot (uptime -s moved)     → 0f3b7c9e-… unchanged
 *   192.0.2.10:8888 (Dozzle)  → HTTP 200 and 1439 bytes of HTML
 *
 * 🔴 That last line is the dangerous one and the reason this file exists. A foreign service
 * answers the identity question with a perfectly healthy 200. Any check that stops at the
 * status code — the obvious one to write — would adopt a stranger's address into a device
 * entry and point a session at the wrong machine. So the counter-control is not decoration
 * here: it is the test that decides whether this feature may ship at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let answer: { ok: boolean; value?: unknown; kind?: string } = { ok: true, value: {} }

vi.mock('@main/zima/client', () => ({
  request: async () =>
    answer.ok
      ? { ok: true as const, value: answer.value }
      : {
          ok: false as const,
          error: { kind: answer.kind ?? 'timeout', message: 'planned', i18nKey: 'error.timeout' },
        },
}))

const realDeviceInfo = {
  arch: 'amd64',
  cpu: { cores: 12, model: '13th Gen Intel(R) Core i7-1360P', threads: 16, frequency: '4.50' },
  device_code: '0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f',
  device_model: 'Default string',
  device_name: 'ZimaOS',
  gpu: [],
  hash: '--',
  is_licensed: false,
  memory: { frequency: '4800 MHz', slots_used: 1, total_byte: 33409363968, type: 'DDR5' },
  os_version: 'v1.7.0',
}

describe('fetchIdentity', () => {
  beforeEach(() => {
    answer = { ok: true, value: realDeviceInfo }
  })

  it('reads the code from a real device document', async () => {
    const { fetchIdentity } = await import('@main/zima/identity')
    const result = await fetchIdentity('192.0.2.10')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.deviceCode).toBe('0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f')
      expect(result.value.osVersion).toBe('v1.7.0')
    }
  })

  it('🔴 refuses an HTML page that arrives with HTTP 200', async () => {
    // Dozzle on port 8888 of the very same host, measured.
    answer = { ok: true, value: '<!doctype html><html class="bg-base-200">…</html>' }

    const { fetchIdentity } = await import('@main/zima/identity')
    const result = await fetchIdentity('192.0.2.10', 8888)

    expect(result.ok).toBe(false)
  })

  it('refuses a JSON document that is not device info', async () => {
    answer = { ok: true, value: { message: 'invalid or expired jwt' } }

    const { fetchIdentity } = await import('@main/zima/identity')
    expect((await fetchIdentity('192.0.2.10')).ok).toBe(false)
  })

  it('refuses a device_code that is empty or a stub', async () => {
    // `hash` was literally "--" on both measured hosts, so placeholder values are real
    // here. A stub must not become an identity that matches another stub.
    answer = { ok: true, value: { ...realDeviceInfo, device_code: '--' } }

    const { fetchIdentity } = await import('@main/zima/identity')
    expect((await fetchIdentity('192.0.2.10')).ok).toBe(false)
  })

  it('tolerates a firmware that drops cosmetic fields', async () => {
    // Only device_code is load-bearing; a missing name or version must not break
    // recognition, or a firmware update silently disables the whole feature.
    answer = { ok: true, value: { device_code: realDeviceInfo.device_code } }

    const { fetchIdentity } = await import('@main/zima/identity')
    const result = await fetchIdentity('192.0.2.10')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.deviceName).toBeNull()
  })
})

describe('sameDevice', () => {
  const code = '0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f'
  const other = '9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d'

  it('matches the same device reached over a different path', async () => {
    const { sameDevice } = await import('@main/zima/identity')
    expect(sameDevice(code, code)).toBe(true)
  })

  it('does not match a different device', async () => {
    const { sameDevice } = await import('@main/zima/identity')
    expect(sameDevice(code, other)).toBe(false)
  })

  it('🔴 never matches when nothing is stored yet', async () => {
    // Every registry entry written before today has no code. If null matched anything,
    // the first ZimaOS found in the LAN would be adopted as "this device".
    const { sameDevice } = await import('@main/zima/identity')
    expect(sameDevice(null, code)).toBe(false)
    expect(sameDevice(undefined, code)).toBe(false)
    expect(sameDevice('', code)).toBe(false)
  })

  it('does not fold case or trim — an exact match or nothing', async () => {
    const { sameDevice } = await import('@main/zima/identity')
    expect(sameDevice(code.toUpperCase(), code)).toBe(false)
    expect(sameDevice(` ${code}`, code)).toBe(false)
  })
})
