import log from 'electron-log/main'
import { setTimeoutTask } from '../timers'
import { getZtNetworkFirstIPv4, isValidNetworkIdFormat, ZeroTier } from '../zerotier'
import { getDeviceByIP } from './ipGet'

const MAX_TRY = 60
const TRY_INTERVAL = 2000

// Leave network function
function leaveNetwork(networkId: string) {
  const zt = ZeroTier.getInstance()

  log.info(`[Get Device by Network ID] Leaving network: ${networkId}`)
  zt.network.deleteNetwork(networkId)
}

function tryGetDeviceByZeroTierNetworkId(
  networkId: string,
  tryCount: number,
  onGotDevice: (info: ZtNetworkDeviceInfo) => void,
  onFailed: (err: Error) => void,
) {
  log.info(`[Get Device by Network ID] Trying to get device by Network ID: ${networkId} (${tryCount}/${MAX_TRY})`)

  // Get the ZeroTier instance
  const zt = ZeroTier.getInstance()

  // Catch function
  function onCatch(err: Error) {
    if (err.message.includes('OS version is too low')) {
      log.info(`[Get Device by Network ID] OS version is too low: ${networkId}`)
      onFailed(new Error('OS version is too low'))
      leaveNetwork(networkId)
    }
    else if (err.message.includes('App version is too low')) {
      log.info(`[Get Device by Network ID] App version is too low: ${networkId}`)
      onFailed(new Error('App version is too low'))
      leaveNetwork(networkId)
    }
    else if (tryCount > MAX_TRY) {
      log.info(`[Get Device by Network ID] Failed to get device by Network ID: ${networkId}`, err)
      log.info('[Get Device by Network ID] Max tries reached.')
      onFailed(new Error('Max tries reached.'))
      leaveNetwork(networkId)
    }
    else {
      log.info(`[Get Device by Network ID] Will retry after ${TRY_INTERVAL / 1000}s`)
      setTimeoutTask(() => {
        tryGetDeviceByZeroTierNetworkId(networkId, tryCount + 1, onGotDevice, onFailed)
      }, TRY_INTERVAL)
    }
  }

  // Get the network
  zt.network.getNetwork(networkId)
    .then((res) => {
      // Get the first IP address of the network
      if (!res.data.assignedAddresses?.length) {
        onCatch(new Error(`Network(${networkId}) does not have any assigned addresses`))
        return
      }
      const firstIP = getZtNetworkFirstIPv4(res.data)

      // Get the device by IP address
      getDeviceByIP(firstIP).then(
        (device) => {
          log.info(`[Get Device by Network ID] Got device by Network ID: ${networkId}`)
          onGotDevice({ device, networkId, remote_ipv4: firstIP })
        },
      ).catch(onCatch)
    })
    .catch((err) => {
      if (err.response?.status === 404) {
        log.info(`[Get Device by Network ID] Network(${networkId}) not joined. Joining...`)
        // Join the network
        zt.network.updateNetwork(networkId, {})
          .then(() => {
            // Try to get the device by ZeroTier network ID immediately after joining the network
            log.info(`[Get Device by Network ID] Joined network: ${networkId}`)
            tryGetDeviceByZeroTierNetworkId(networkId, tryCount, onGotDevice, onFailed)
          })
          .catch(() => {
            onFailed(new Error(`Failed to join network: ${networkId}`))
          })
      }
      else {
        onCatch(err)
      }
    })
}

export function getDeviceByZeroTierNetworkId(networkId: string): Promise<ZtNetworkDeviceInfo> {
  log.info(`[Get Device by Network ID] Getting device by Network ID: ${networkId}`)
  return new Promise((resolve, reject) => {
    // Validate the network ID format
    if (!isValidNetworkIdFormat(networkId)) {
      reject(new Error('Invalid network ID format'))
      return
    }

    // Try to get the device by ZeroTier network ID
    tryGetDeviceByZeroTierNetworkId(networkId, 1, resolve, reject)
  })
}
