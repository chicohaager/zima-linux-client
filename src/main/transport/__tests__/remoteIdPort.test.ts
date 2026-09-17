import { describe, expect, it, vi } from 'vitest'
import { ok } from '@shared/result'
import { CHANNELS } from '@shared/channels'
import { channelSchemas } from '@shared/contract'
import type * as ZerotierDaemon from '@main/zerotier/daemon'

/*
 * The Remote ID path carries the device's WebUI port; it is not the strategy's constant.
 *
 * Measured 2026-09-17 from a tester (client 2.0.1, ZimaOS v1.7.1, "WebUI Port" = 443):
 * the ZeroTier join succeeded, the address was derived, and the probe went to port 80 —
 * `refused · candidates=1`. Over ZeroTier there is no mDNS to read the port from, so the
 * user provides it and it must travel from the form through the contract into the
 * candidate. Documentation-range addresses only.
 */

vi.mock('@main/zerotier/daemon', async (importOriginal) => {
  const actual = await importOriginal<typeof ZerotierDaemon>()
  return {
    ...actual,
    joinNetwork: vi.fn(async (networkId: string) =>
      ok({
        daemon: 'managed' as const,
        running: true,
        nodeId: 'abcdefabcd',
        problem: null,
        networks: [
          {
            networkId,
            name: 'test-net',
            status: 'OK',
            type: 'PUBLIC',
            assignedAddresses: ['198.51.100.7/16'],
            routeTargets: ['198.51.0.0/16'],
          },
        ],
      }),
    ),
    joinBlockedReason: vi.fn(async () => null),
  }
})

const { remoteIdStrategy } = await import('@main/transport/strategy')

describe('the Remote ID candidate takes the port the user entered', () => {
  it('derives the device address on the given port', async () => {
    const outcome = await remoteIdStrategy('0123456789abcdef', 443)
    expect(outcome.unavailableReason).toBeNull()
    expect(outcome.candidates).toEqual([
      { kind: 'remote-id', host: '198.51.0.1', port: 443, priority: 0 },
    ])
  })

  // Positive control for the default: nothing changes for the common case.
  it('still uses 80 when no port is given', async () => {
    const outcome = await remoteIdStrategy('0123456789abcdef')
    expect(outcome.candidates[0]?.port).toBe(80)
  })
})

describe('the IPC contract carries the port', () => {
  const request = channelSchemas[CHANNELS.connectRemoteId].request

  it('defaults to 80 when the renderer sends none', () => {
    expect(request.parse({ remoteId: '0123456789abcdef' })).toEqual({ remoteId: '0123456789abcdef', port: 80 })
  })

  it('passes a user-chosen port through unchanged', () => {
    expect(request.parse({ remoteId: '0123456789abcdef', port: 443 }).port).toBe(443)
  })

  it.each([0, 65536, 1.5, -1])('rejects %s as a port', (port) => {
    expect(request.safeParse({ remoteId: '0123456789abcdef', port }).success).toBe(false)
  })
})
