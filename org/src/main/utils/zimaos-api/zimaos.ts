import type { AxiosInstance } from 'axios'
import type http from 'node:http'
import type https from 'node:https'
import { Configuration, ZeroTierMethodsApi } from '@icewhale/zimaos-openapi'
import {
  Configuration as UserserviceV1Configuration,
  UserApi as UserserviceV1UserApi,
} from '@icewhale/zimaos-userservice-openapi/dist/v1'
import axios from 'axios'
import { AuthInterceptors } from './authInterceptors'

interface ZimaOSAPIConfig {
  remoteIpv4?: string
  port?: number
  httpAgent?: http.Agent
  httpsAgent?: https.Agent
}

export class ZimaOSAPI {
  private static instance: ZimaOSAPI
  private _axiosInstance: AxiosInstance = axios.create()
  private _authInterceptors?: AuthInterceptors

  // APIs
  private _zimaos?: {
    zerotier: ZeroTierMethodsApi
  }

  private _userservice?: {
    user: UserserviceV1UserApi
  }

  public static getInstance() {
    if (!ZimaOSAPI.instance) {
      ZimaOSAPI.instance = new ZimaOSAPI()
    }
    return ZimaOSAPI.instance
  }

  private constructor() {}

  public initAPIs(config?: ZimaOSAPIConfig) {
    // Eject previous interceptors
    this._authInterceptors?.eject()

    // Initialize new AxiosInstance
    this.initAxiosInstance(config)

    // Initialize new AuthInterceptors
    this._authInterceptors = new AuthInterceptors(this._axiosInstance)
    this._authInterceptors.setup()

    // Initialize APIs
    this.initZimaos()
    this.initUserservice()
  }

  private initAxiosInstance(config?: ZimaOSAPIConfig) {
    const remoteIpv4 = config?.remoteIpv4
    const port = config?.port
    const baseURL = remoteIpv4 ? `http://${remoteIpv4}:${port}` : ''

    this._axiosInstance = axios.create({
      baseURL,
      httpAgent: config?.httpAgent,
      httpsAgent: config?.httpsAgent,
    })
  }

  private initZimaos() {
    const v2BasePath = '/v2/zimaos'

    const v2Config = new Configuration({
      // Authorization header is set by AuthInterceptors
      baseOptions: {
        baseURL: this._axiosInstance.defaults.baseURL + v2BasePath,
      },
    })

    this._zimaos = {
      zerotier: new ZeroTierMethodsApi(v2Config, undefined, this._axiosInstance),
    }

    return this._zimaos
  }

  get zimaos() {
    return this._zimaos ?? this.initZimaos()
  }

  private initUserservice() {
    const v1BasePath = '/v1/users'

    const v1Config = new UserserviceV1Configuration({
      // Authorization header is set by AuthInterceptors
      baseOptions: {
        baseURL: this._axiosInstance.defaults.baseURL + v1BasePath,
      },
    })

    this._userservice = {
      user: new UserserviceV1UserApi(v1Config, undefined, this._axiosInstance),
    }

    return this._userservice
  }

  get userservice() {
    return this._userservice ?? this.initUserservice()
  }
}
