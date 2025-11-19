import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import log from 'electron-log/main'
import { ConnectionManager } from '../device'
import { ZimaOSAPI } from './zimaos'

const NO_AUTH_PATHS = [
  '/v1/users/login',
  '/v1/users/register',
  '/v1/users/refresh',
]

export class AuthInterceptors {
  private isRefreshing = false
  private refreshRequests: Array<(token: string) => void> = []
  private requestInterceptorId?: number
  private responseInterceptorId?: number

  constructor(private axiosInstance: AxiosInstance) {}

  public setup() {
    this.requestInterceptorId = this.setupRequestInterceptor()
    this.responseInterceptorId = this.setupResponseInterceptor()
  }

  public eject() {
    if (this.requestInterceptorId) {
      this.axiosInstance.interceptors.request.eject(this.requestInterceptorId)
      this.requestInterceptorId = undefined
    }

    if (this.responseInterceptorId) {
      this.axiosInstance.interceptors.response.eject(this.responseInterceptorId)
      this.responseInterceptorId = undefined
    }

    this.refreshRequests = []
    this.isRefreshing = false
  }

  private setupRequestInterceptor() {
    return this.axiosInstance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const fullUrl = `${config.baseURL}${config.url}`
        if (fullUrl && NO_AUTH_PATHS.some(
          (url) => { return fullUrl.endsWith(url) },
        )) {
          return config
        }

        const cm = ConnectionManager.getInstance()
        if (cm.authentication?.access_token) {
          config.headers.Authorization = cm.authentication.access_token
        }
        return config
      },
    )
  }

  private setupResponseInterceptor() {
    return this.axiosInstance.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        const originalConfig = error.config

        if (!originalConfig) {
          return Promise.reject(error)
        }

        const fullUrl = `${originalConfig.baseURL}${originalConfig.url}`
        if (originalConfig.url && !NO_AUTH_PATHS.some((url) => {
          return fullUrl.endsWith(url)
        })) {
          if (error.response?.status === 401) {
            if (!this.isRefreshing) {
              this.isRefreshing = true
              log.info('[Response Interceptor] Refresh token')
              try {
                const authentication = ConnectionManager.getInstance().authentication
                if (!authentication) {
                  throw new Error('No authentication found')
                }

                const response = await ZimaOSAPI.getInstance().userservice.user.refreshUserToken({
                  refresh_token: authentication.refresh_token,
                })

                log.info(`[Response Interceptor] Token refreshed. Expires at: ${response.data.data.expires_at}`)

                const newAuth: ConnectionAuthentication = {
                  access_token: response.data.data.access_token!,
                  refresh_token: response.data.data.refresh_token!,
                  expires_at: response.data.data.expires_at!,
                }

                ConnectionManager.getInstance().authentication = newAuth
                originalConfig.headers.Authorization = newAuth.access_token
                this.axiosInstance.defaults.headers.Authorization = newAuth.access_token

                this.processQueuedRequests(newAuth.access_token)
                this.isRefreshing = false

                return this.axiosInstance(originalConfig)
              }
              catch (err) {
                if (
                  ConnectionManager.getInstance().currentConnectionPath
                  && error.response?.status === 401
                ) {
                  log.info('[Response Interceptor] Token expired, logging out.')
                  this.handleLogout()
                }
                this.isRefreshing = false
                this.refreshRequests.forEach(async cb => cb(await Promise.reject(err)))
                this.refreshRequests = []
                return Promise.reject(err)
              }
            }

            // Put the request in the queue
            return new Promise((resolve) => {
              this.refreshRequests.push((token) => {
                originalConfig.headers.Authorization = token
                resolve(this.axiosInstance(originalConfig))
              })
            })
          }
        }

        return Promise.reject(error)
      },
    )
  }

  private processQueuedRequests(token: string) {
    this.refreshRequests.forEach(cb => cb(token))
    this.refreshRequests = []
  }

  private handleLogout() {
    ConnectionManager.getInstance().logout()
  }
}
