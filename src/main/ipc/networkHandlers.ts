import { CHANNELS } from '@shared/contract'
import { appError, isErr, ok } from '@shared/result'
import * as tailscale from '@main/tailscale/detect'
import * as zerotier from '@main/zerotier/daemon'
import { provision as provisionZerotier } from '@main/zerotier/provision'
import { importProfile, scanLegacyProfiles } from '@main/legacy/import'
import { rank, remoteIdStrategy } from '@main/transport/strategy'
import { logger } from '@main/logging/logger'
import { handle, toWire, wireError } from './wire'

/**
 * ZeroTier (the Remote-ID route) and the read-only import of 0.9.x configuration.
 *
 * Both talk to the local machine rather than to a device, so they need no session — which is
 * the point for ZeroTier: you have to be able to look at the network state BEFORE you can
 * reach a device over it.
 */

export const registerNetworkHandlers = (): void => {
  handle(CHANNELS.zerotierState, async () => ok(await zerotier.readRuntime()))

  handle(CHANNELS.zerotierJoin, async (input) => {
    const { networkId } = input as { networkId: string }
    // Lower-cased because the daemon's own listing returns lower-case ids, and a mixed-case
    // id would produce a second entry for a network the user already joined.
    return toWire(await zerotier.joinNetwork(networkId.toLowerCase()))
  })

  handle(CHANNELS.zerotierLeave, async (input) => {
    const { networkId } = input as { networkId: string }
    return toWire(await zerotier.leaveNetwork(networkId.toLowerCase()))
  })

  // Read-only, and with no join/leave counterpart on purpose: this client detects a tunnel
  // that is already running and never takes it over. Taking a tunnel over is what displaces
  // a user's own DNS — the reason someone had to choose between remote access and their
  // AdGuard filtering. See main/tailscale/detect.ts.
  handle(CHANNELS.tailscaleState, async () => toWire(await tailscale.readRuntime()))

  /**
   * Remote ID -> a reachable address, in one step from the user's side.
   *
   * Everything the old ZeroTier panel asked the user to do by hand happens here: start the
   * daemon, join, derive the device's address, and PROVE it answers. The reply is an
   * address the sign-in form can use, or a named reason — never an empty result that would
   * read as "no device there".
   */
  handle(CHANNELS.connectRemoteId, async (input) => {
    const { remoteId } = input as { remoteId: string }
    const outcome = await remoteIdStrategy(remoteId)
    if (outcome.unavailableReason !== null) {
      return wireError(
        appError('capability-missing', outcome.unavailableReason, 'error.strategyUnavailable', {
          kind: 'remote-id',
        }),
      )
    }
    const ranked = await rank(outcome.candidates)
    if (isErr(ranked)) return toWire(ranked)

    const winner = ranked.value.probes.find((result) => result.reachable)
    const runtime = await zerotier.readRuntime()
    const network = runtime.networks.find(
      (entry) => entry.networkId === remoteId.trim().toLowerCase(),
    )
    logger.info('remote-id.resolved', {
      host: ranked.value.best.host,
      latencyMs: winner?.latencyMs ?? null,
    })
    return ok({
      host: ranked.value.best.host,
      port: ranked.value.best.port,
      latencyMs: winner?.latencyMs ?? null,
      networkName: network?.name ?? '',
    })
  })

  handle(CHANNELS.zerotierProvision, async () => toWire(await provisionZerotier()))

  handle(CHANNELS.legacyScan, async () => ok(scanLegacyProfiles()))

  handle(CHANNELS.legacyImport, async (input) => {
    const { directory } = input as { directory: string }
    // The directory must be one the scan actually found. Accepting an arbitrary path from the
    // renderer would let it ask the main process to read anywhere on disk.
    const known = scanLegacyProfiles().some((profile) => profile.directory === directory)
    if (!known) return ok({ imported: 0, skipped: 0 })
    const result = importProfile(directory)
    return isErr(result) ? toWire(result) : ok(result.value)
  })
}
