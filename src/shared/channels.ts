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
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]
