/**
 * IPC channel names — deliberately free of any dependency.
 *
 * The preload script runs in a sandboxed context, where it can only `require` a handful
 * of built-ins. Anything it imports must therefore be bundled, and pulling the zod
 * schemas in would drag a whole validation library into the most privileged boundary of
 * the app for no benefit: the preload only needs the names, while the schemas are used by
 * the main process and the renderer.
 */
export const CHANNELS = {
  discoveryScan: 'discovery:scan',
  transportProbe: 'transport:probe',
  deviceCapabilities: 'device:capabilities',
  secretsStatus: 'secrets:status',
  secretsConsent: 'secrets:consent',
  appInfo: 'app:info',
  sessionSignIn: 'session:sign-in',
  sessionResume: 'session:resume',
  sessionCurrent: 'session:current',
  sessionSignOut: 'session:sign-out',
  devicesList: 'devices:list',
  devicesSetActive: 'devices:set-active',
  devicesSetPriorities: 'devices:set-priorities',
  devicesForget: 'devices:forget',
  devicesPower: 'devices:power',

  filesList: 'files:list',
  filesSearch: 'files:search',
  filesCreateFolder: 'files:create-folder',
  filesTransfer: 'files:transfer',
  filesTasks: 'files:tasks',
  filesTrashMove: 'files:trash-move',
  filesTrashList: 'files:trash-list',
  filesTrashRestore: 'files:trash-restore',
  filesPins: 'files:pins',
  filesDownload: 'files:download',
  filesUpload: 'files:upload',

  photosGallery: 'photos:gallery',
  photosFolderGrid: 'photos:folder-grid',
  photosProgress: 'photos:progress',
  photosSearch: 'photos:search',
  photosBackupStart: 'photos:backup-start',
  photosBackupStatus: 'photos:backup-status',
  photosBackupCancel: 'photos:backup-cancel',
  photosPickFolders: 'photos:pick-folders',

  appsList: 'apps:list',
  appsSetRunning: 'apps:set-running',
  appsOpenWebUi: 'apps:open-web-ui',

  systemUtilization: 'system:utilization',
  systemDeviceInfo: 'system:device-info',
  systemVolumes: 'system:volumes',

  zerotierState: 'zerotier:state',
  zerotierJoin: 'zerotier:join',
  zerotierLeave: 'zerotier:leave',
  /**
   * Install this client's own zerotier-one and grant it CAP_NET_ADMIN, once, with an
   * authentication prompt. Explicit rather than automatic: it raises a password dialog and
   * changes a file's privileges.
   */
  zerotierProvision: 'zerotier:provision',

  /**
   * Read-only on purpose. ZeroTier has join/leave because this client runs that daemon;
   * Tailscale has neither, because it does not operate the tunnel — it only asks whether
   * one is already there. See main/tailscale/detect.ts.
   */
  tailscaleState: 'tailscale:state',

  /**
   * Resolve a Remote ID to a reachable device address: join the network, derive the
   * device's address, probe it. The user types an ID and signs in — the ZeroTier part is
   * machinery, not a step they perform.
   */
  connectRemoteId: 'connect:remote-id',

  legacyScan: 'legacy:scan',
  legacyImport: 'legacy:import',

  logsOpenFolder: 'logs:open-folder',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
