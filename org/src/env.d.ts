/// <reference types="vite/client" />
/// <reference path="./device.d.ts" />
/// <reference path="./types/zima-backup-v2.d.ts" />

// ------------------------------
// Type Helpers
// ------------------------------

type NestedPath<T extends 'array' | 'object', P, C = undefined> =
  `${P & string}${T extends 'array' ? `[${number}]` : ''}${C extends string ? `.${C}` : ''}`

type DeepNested<V, K = ''> =
  V extends object[]
    ? NestedPath<'array', K, DeepPath<V[number]> | undefined>
    : V extends unknown[]
      ? NestedPath<'array', K>
      : V extends object
        ? NestedPath<'object', K, DeepPath<V>>
        : never

type DeepPath<T extends object> = {
  [Q in keyof T]-?: Q | DeepNested<NonNullable<T[Q]>, Q>;
}[keyof T]

// ------------------------------
// Type Definitions
// ------------------------------

// Vite Env
interface ImportMetaEnv {
  // .env
  readonly VITE_APP_VERSION: string
  readonly VITE_ZEROTIER_INSTALLER_VERSION: string
  readonly VITE_MIN_OS_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ZtNetworkDeviceInfo {
  device: DeviceInfo
  networkId: string
  remote_ipv4: string
}

interface ConnectionZtNetwork {
  networkId: string
  remote_ipv4: string
}
interface ConnectionAuthentication {
  access_token: string
  refresh_token: string
  expires_at: number
}

type ConnectionMethod = 'wifi' | 'ethernet' | 'thunderbolt' | 'remote'
interface ConnectionPath {
  method: ConnectionMethod
  local_ipv4: string
  remote_ipv4: string
}

interface ConfigSchema {
  hostname: string
  initialized: boolean
  language: string
  theme: 'system' | 'light' | 'dark'
  device: {
    lastDeviceHash?: string
    lastNetworkId?: string
    lastDeviceIp?: string
  }
  connection: {
    device?: any
    ztNetwork?: ConnectionZtNetwork
    authentication?: ConnectionAuthentication
    user?: any
    lastConnectionPath?: ConnectionPath
    lastUsername?: string
  }
  updateChannel: 'latest' | 'beta' | 'alpha'
  testing: {
    ui?: number
  }
}

type ConfigSchemaKeys = DeepPath<ConfigSchema>

interface UserCustom {
  wallpaper?: {
    path: string
    from: string
  }
  [key: string]: any
}
