import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type http from 'node:http'
import axios from 'axios'
import semver from 'semver'
import { ConnectionManager } from './connection'

export function getDeviceByIP(ip: string, httpAgent?: http.Agent, timeout?: number): Promise<DeviceInfo> {
  return new Promise((resolve, reject) => {
    // Get the device info
    const url = `http://${ip}:9527`
    axios.get(
      url,
      {
        httpAgent: httpAgent || ConnectionManager.httpAgent,
        timeout: timeout || 1000,
      },
    )
      .then((res) => {
        const data: DeviceInfo = res.data
        if (
          data.hash
          && data.min_client_version
          && data.os_version
          && data.port
          && data.request_ip
        ) {
          if (semver.lt(data.os_version!, import.meta.env.VITE_MIN_OS_VERSION)) {
            reject(new Error('OS version is too low'))
          }
          else if (semver.lt(import.meta.env.VITE_APP_VERSION, data.min_client_version!)) {
            reject(new Error('App version is too low'))
          }
          else {
            resolve(data)
          }
        }
        else {
          reject(new Error('Invalid device info'))
        }
      })
      .catch(reject)
  })
}
