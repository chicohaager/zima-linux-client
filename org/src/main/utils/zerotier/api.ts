import { Config } from '@main/config'
import {
  Configuration,
  ControllerApi,
  NetworkApi,
  PeerApi,
  StatusApi,
} from 'zerotierone-api-ts-axios'

export class ZeroTier {
  private static instance: ZeroTier
  private static authtoken?: Configuration['apiKey']

  public controller: ControllerApi
  public network: NetworkApi
  public peer: PeerApi
  public status: StatusApi

  private constructor() {
    const config = new Configuration({
      apiKey: ZeroTier.authtoken,
    })

    this.controller = new ControllerApi(config)
    this.network = new NetworkApi(config)
    this.peer = new PeerApi(config)
    this.status = new StatusApi(config)
  }

  public static getInstance(): ZeroTier {
    if (!ZeroTier.instance) {
      ZeroTier.instance = new ZeroTier()
    }
    return ZeroTier.instance
  }

  public static setAuthtoken(authtoken: Configuration['apiKey']) {
    const firstTimeGetAuthtoken = !ZeroTier.authtoken
    ZeroTier.authtoken = authtoken
    ZeroTier.instance = new ZeroTier()

    if (firstTimeGetAuthtoken) {
      // Clear unused networks
      ZeroTier.instance.network.getNetworks().then((res) => {
        const networkName = 'IceWhale-RemoteAccess'
        const iwraNetworks = res.data.filter(network => network.name === networkName)
        const connectedNetworkId = Config.get('connection.ztNetwork.networkId') as any
        iwraNetworks.forEach((network) => {
          if (network.id === connectedNetworkId) {
            return
          }
          network.id && ZeroTier.instance.network.deleteNetwork(network.id)
        })
      })
    }
  }
}

export type * from 'zerotierone-api-ts-axios'
