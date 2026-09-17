import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The handler is the one line that can drop the port between contract and strategy —
 * `remoteIdStrategy(remoteId)` compiled fine for weeks while the port was fixed at 80.
 * The strategy and the contract have their own tests; this one covers the join.
 */

const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
const remoteIdStrategy = vi.fn()
const rank = vi.fn()

vi.mock('@main/logging/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../wire', () => ({
  handle: (channel: string, fn: (input: unknown) => Promise<unknown>) => {
    handlers.set(channel, fn)
  },
  toWire: (result: { ok: boolean }) => result,
  wireError: (error: unknown) => ({ ok: false, error }),
}))
vi.mock('@main/transport/strategy', () => ({ remoteIdStrategy, rank }))
vi.mock('@main/tailscale/detect', () => ({ readRuntime: vi.fn() }))
vi.mock('@main/zerotier/daemon', () => ({
  readRuntime: vi.fn(),
  joinNetwork: vi.fn(),
  leaveNetwork: vi.fn(),
}))
vi.mock('@main/zerotier/provision', () => ({ provision: vi.fn() }))
vi.mock('@main/legacy/import', () => ({ importProfile: vi.fn(), scanLegacyProfiles: vi.fn() }))

const { CHANNELS } = await import('@shared/contract')
const { registerNetworkHandlers } = await import('../networkHandlers')

beforeEach(() => {
  handlers.clear()
  remoteIdStrategy.mockReset()
  rank.mockReset()
  registerNetworkHandlers()
})

describe('connectRemoteId hands the port to the strategy', () => {
  it('passes the port from the request through', async () => {
    remoteIdStrategy.mockResolvedValue({ kind: 'remote-id', candidates: [], unavailableReason: 'stub' })
    const handler = handlers.get(CHANNELS.connectRemoteId)
    expect(handler).toBeDefined()
    await handler?.({ remoteId: '0123456789abcdef', port: 443 })
    expect(remoteIdStrategy).toHaveBeenCalledWith('0123456789abcdef', 443)
  })
})
