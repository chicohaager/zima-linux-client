import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ChannelName } from '@shared/channels'
import type { RequestOf, ResponseOf } from '@shared/contract'

/**
 * The only bridge across the process boundary.
 *
 * It exposes exactly the channels from the contract — no generic `invoke(channel)`
 * escape hatch, because that would let the renderer reach anything the main process
 * ever registers.
 */

const invoke = <C extends ChannelName>(channel: C) =>
  (request: RequestOf<C>): Promise<ResponseOf<C>> =>
    ipcRenderer.invoke(channel, request) as Promise<ResponseOf<C>>

const api = {
  scanNetwork: invoke(CHANNELS.discoveryScan),
  probeHost: invoke(CHANNELS.transportProbe),
  readCapabilities: invoke(CHANNELS.deviceCapabilities),
  secretStoreStatus: invoke(CHANNELS.secretsStatus),
  setPlaintextConsent: invoke(CHANNELS.secretsConsent),
  appInfo: invoke(CHANNELS.appInfo),

  signIn: invoke(CHANNELS.sessionSignIn),
  resumeSession: invoke(CHANNELS.sessionResume),
  currentSession: invoke(CHANNELS.sessionCurrent),
  signOut: invoke(CHANNELS.sessionSignOut),

  listDevices: invoke(CHANNELS.devicesList),
  setActiveDevice: invoke(CHANNELS.devicesSetActive),
  setAddressPriorities: invoke(CHANNELS.devicesSetPriorities),
  forgetDevice: invoke(CHANNELS.devicesForget),
} as const

export type ZimaApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('zima', api)
} else {
  // Never silently degrade: without context isolation the security model is gone,
  // so this must be visible rather than papered over with a global assignment.
  throw new Error('context isolation is disabled — refusing to expose the IPC bridge')
}
