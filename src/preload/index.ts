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
  powerDevice: invoke(CHANNELS.devicesPower),

  listFiles: invoke(CHANNELS.filesList),
  searchFiles: invoke(CHANNELS.filesSearch),
  createFolder: invoke(CHANNELS.filesCreateFolder),
  transferFiles: invoke(CHANNELS.filesTransfer),
  fileTasks: invoke(CHANNELS.filesTasks),
  moveToTrash: invoke(CHANNELS.filesTrashMove),
  listTrash: invoke(CHANNELS.filesTrashList),
  restoreFromTrash: invoke(CHANNELS.filesTrashRestore),
  listPins: invoke(CHANNELS.filesPins),
  downloadFile: invoke(CHANNELS.filesDownload),
  uploadFiles: invoke(CHANNELS.filesUpload),

  photoGallery: invoke(CHANNELS.photosGallery),
  photoFolderGrid: invoke(CHANNELS.photosFolderGrid),
  photoIndexProgress: invoke(CHANNELS.photosProgress),
  photoSearch: invoke(CHANNELS.photosSearch),
  pickBackupFolders: invoke(CHANNELS.photosPickFolders),
  startPhotoBackup: invoke(CHANNELS.photosBackupStart),
  photoBackupStatus: invoke(CHANNELS.photosBackupStatus),
  cancelPhotoBackup: invoke(CHANNELS.photosBackupCancel),

  listApps: invoke(CHANNELS.appsList),
  setAppRunning: invoke(CHANNELS.appsSetRunning),
  openAppWebUi: invoke(CHANNELS.appsOpenWebUi),

  utilization: invoke(CHANNELS.systemUtilization),
  deviceInfo: invoke(CHANNELS.systemDeviceInfo),
  storageVolumes: invoke(CHANNELS.systemVolumes),

  zerotierState: invoke(CHANNELS.zerotierState),
  zerotierJoin: invoke(CHANNELS.zerotierJoin),
  zerotierLeave: invoke(CHANNELS.zerotierLeave),
  zerotierProvision: invoke(CHANNELS.zerotierProvision),
  tailscaleState: invoke(CHANNELS.tailscaleState),
  connectRemoteId: invoke(CHANNELS.connectRemoteId),

  scanLegacyProfiles: invoke(CHANNELS.legacyScan),
  importLegacyProfile: invoke(CHANNELS.legacyImport),

  openLogFolder: invoke(CHANNELS.logsOpenFolder),
} as const

export type ZimaApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('zima', api)
} else {
  // Never silently degrade: without context isolation the security model is gone,
  // so this must be visible rather than papered over with a global assignment.
  throw new Error('context isolation is disabled — refusing to expose the IPC bridge')
}
