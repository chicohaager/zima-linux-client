import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type si from 'systeminformation'
import dgram from 'node:dgram'
import log from 'electron-log/main'
import ip from 'ip'
import { clearTimeoutTask, setTimeoutTask } from '../timers'
import { getConnectedNetworkInterfaces } from './ifaces'

// UDP Discover
const udpClients: dgram.Socket[] = []
const UDP_TIMEOUT = 5000
const UDP_PORT = 9527
const UDP_MESSAGE = '9527'

export async function udpDiscover(
  iface: si.Systeminformation.NetworkInterfacesData,
  onDeviceFound?: (device: DeviceInfo, remote_ipv4: string) => void,
  onAllTasksFinished?: () => void,
) {
  if (!iface.ip4 || !iface.ip4subnet) {
    log.warn(`[UDP Discovery] ${iface.ifaceName} does not have an IPv4 address`)
    return
  }

  // Get the broadcast address
  const broadcastAddress = ip.subnet(iface.ip4, iface.ip4subnet).broadcastAddress

  // Create a new UDP client
  const udpClient = dgram.createSocket('udp4')
  udpClients.push(udpClient)

  // Bind the client to the interface
  udpClient.bind({
    address: iface.ip4,
    port: 0,
    exclusive: false,
  }, () => {
    // Set the client to broadcast mode
    udpClient.setBroadcast(true)

    // Listen for messages
    udpClient.on('message', (msg, rinfo) => {
      const msgJson = JSON.parse(msg.toString())
      if (msgJson.hash && msgJson.request_ip === iface.ip4) {
        log.info(
          `[UDP Discovery] Found device: ${rinfo.address}:${msgJson.port}`,
        )
        onDeviceFound?.(msgJson as DeviceInfo, rinfo.address)
      }
    })

    // Send the UDP message
    udpClient.send(UDP_MESSAGE, UDP_PORT, broadcastAddress, (err) => {
      if (err) {
        log.error(`[UDP Discovery] Failed to send UDP message: ${err}`)
      }
      else {
        log.info(`[UDP Discovery] Started on ${iface.ifaceName}: ${iface.ip4} -> ${broadcastAddress}`)
        const timeoutTask = setTimeoutTask(() => {
          log.info(`[UDP Discovery] Ended on ${iface.ifaceName}: ${iface.ip4} -> ${broadcastAddress}`)
          clearTimeoutTask(timeoutTask)
          udpClient.close()
          udpClients.splice(udpClients.indexOf(udpClient), 1)
          if (udpClients.length === 0) {
            onAllTasksFinished?.()
          }
        }, UDP_TIMEOUT)
      }
    })
  })
}

export function onUdpDiscoverEnd(event: Electron.IpcMainInvokeEvent) {
  log.info('[UDP Discovery] Discovery ended')
  if (event.sender && !event.sender.isDestroyed()) {
    event.sender.send('device:discover:ended')
  }
}

export async function discoverDevices(
  event: Electron.IpcMainInvokeEvent,
  typeFilter?: 'wifi' | 'ethernet' | 'thunderbolt',
) {
  const connectedIfaces = await getConnectedNetworkInterfaces()

  if (!Object.values(connectedIfaces).some(ifaces => ifaces.length > 0)) {
    log.info('[UDP Discovery] No interfaces connected')
    onUdpDiscoverEnd(event)
    return
  }
  Object.entries(connectedIfaces).forEach(([type, ifaces]) => {
    if (typeFilter) {
      if (typeFilter !== type) {
        return
      }
      else if (ifaces.length === 0) {
        log.info(`[UDP Discovery] No ${type} interfaces connected`)
        onUdpDiscoverEnd(event)
        return
      }
    }
    ifaces.forEach((iface) => {
      udpDiscover(
        iface,
        (device, remote_ipv4) => {
          if (event.sender && !event.sender.isDestroyed()) {
            event.sender.send('device:discover:found', device, type, remote_ipv4)
          }
        },
        () => {
          onUdpDiscoverEnd(event)
        },
      )
    })
  })
}
