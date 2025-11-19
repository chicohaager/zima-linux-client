import { platform } from '@electron-toolkit/utils'
import si from 'systeminformation'

function isIPv4Connected(iface: si.Systeminformation.NetworkInterfacesData) {
  return iface.ip4 && iface.ip4subnet
}

// function isIPv6Connected(iface: si.Systeminformation.NetworkInterfacesData) {
//   return iface.ip6 && iface.ip6subnet
// }

// function isConnected(iface: si.Systeminformation.NetworkInterfacesData) {
//   return isIPv4Connected(iface) || isIPv6Connected(iface)
// }

function isWifi(iface: si.Systeminformation.NetworkInterfacesData) {
  return (
    iface.type === 'wireless'
    && !iface.virtual
    && !iface.internal
    && !(
      // Exclude some special wireless interfaces on macOS
      platform.isMacOS
      && (
        iface.ifaceName.startsWith('awdl') // Apple Wireless Direct Link
        || iface.ifaceName.startsWith('llw') // Low Latency Wi-Fi
      )
    )
  )
}

function isEthernet(iface: si.Systeminformation.NetworkInterfacesData) {
  // Exclude Docker bridge interfaces and ZeroTier virtual interfaces
  const ifaceNameLower = iface.ifaceName.toLowerCase()
  const isDockerOrBridge =
    ifaceNameLower.startsWith('docker')
    || ifaceNameLower.startsWith('br-')
    || ifaceNameLower.startsWith('veth')
    || ifaceNameLower.startsWith('zt') // ZeroTier interfaces

  return (
    iface.type === 'wired'
    && !iface.internal
    && !isDockerOrBridge // Exclude Docker/Bridge/ZeroTier instead of all virtual
    && !(
      // Exclude some special wired interfaces on macOS
      platform.isMacOS
      && (
        iface.ifaceName.startsWith('feth') // Forwarded Ethernet
        || iface.ifaceName.startsWith('utun') // User-space TUN
      )
    )
    && !isThunderbolt(iface) // Exclude Thunderbolt
  )
}

function isThunderbolt(iface: si.Systeminformation.NetworkInterfacesData) {
  const ifaceNameLower = iface.ifaceName.toLowerCase()
  return (
    ifaceNameLower.includes('thunderbolt') // Thunderbolt
    || (ifaceNameLower.startsWith('bridge') && platform.isMacOS) // macOS
    || ifaceNameLower.includes('p2p network adapter') // Windows
  )
}

export async function getConnectedNetworkInterfaces() {
  const data = await si.networkInterfaces() as si.Systeminformation.NetworkInterfacesData[]
  return {
    // default: data.filter(iface => iface.default && isConnected(iface)),
    wifi: data.filter(iface => isWifi(iface) && isIPv4Connected(iface)),
    ethernet: data.filter(iface => isEthernet(iface) && isIPv4Connected(iface)),
    thunderbolt: data.filter(iface => isThunderbolt(iface) && isIPv4Connected(iface)),
  }
}
