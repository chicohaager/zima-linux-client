import type { Network } from 'zerotierone-api-ts-axios'
import ip from 'ip'

/**
 * Calculate the CIDR subnet of an IPv4 range.
 *
 * @param {string} ipRangeStart The start IPv4 address.
 * @param {string} ipRangeEnd The end IPv4 address.
 * @returns {string} The CIDR subnet.
 */
export function getSubnetFromIPv4Range(
  ipRangeStart: string,
  ipRangeEnd: string,
): string {
  // Convert the start and end IP addresses to long integers
  const startLong = ip.toLong(ipRangeStart) >>> 0
  const endLong = ip.toLong(ipRangeEnd) >>> 0

  // Calculate the total length of the IP address range
  const totalIPs = (endLong - startLong + 1) >>> 0

  // Calculate the CIDR prefix length
  let prefixLength = 32 - Math.floor(Math.log2(totalIPs))

  // If the start and end addresses are not in the same subnet, subtract 1 from the prefix length
  const startNetwork
    = (startLong >>> (32 - prefixLength)) << (32 - prefixLength)
  const endNetwork = (endLong >>> (32 - prefixLength)) << (32 - prefixLength)
  if (startNetwork !== endNetwork) {
    prefixLength--
  }

  // Calculate the network address of the CIDR subnet
  const networkLong = startLong >>> (32 - prefixLength)
  const networkIP = ip.fromLong(networkLong << (32 - prefixLength))
  const cidr = `${networkIP}/${prefixLength}`

  return cidr
}

/**
 * Get first IP address of a ZeroTier network.
 * @param {Network} network The ZeroTier network .
 * @returns {string} The first IP address of the network.
 */
export function getZtNetworkFirstIPv4(network: Network): string {
  if (!network.assignedAddresses?.length) {
    throw new Error(`Network(${network.id}) does not have any assigned addresses`)
  }

  const ipv4Cidr = network.assignedAddresses.filter(address =>
    ip.isV4Format(address.split('/')[0]),
  )[0]

  const firstIP = ip.cidrSubnet(ipv4Cidr).firstAddress
  return firstIP
}

export function getZtNetworkLocalIPv4(network: Network): string {
  if (!network.assignedAddresses?.length) {
    throw new Error(`Network(${network.id}) does not have any assigned addresses`)
  }

  const ipv4 = network.assignedAddresses.filter(address =>
    ip.isV4Format(address.split('/')[0]),
  )[0].split('/')[0]

  return ipv4
}

export function isValidNetworkIdFormat(networkId: string): boolean {
  return /^[\da-f]{16}$/.test(networkId.toLowerCase())
}
