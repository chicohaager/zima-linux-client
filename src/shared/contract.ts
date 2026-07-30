import { z } from 'zod'

/**
 * The IPC contract — one schema per channel, the single source of truth for what
 * crosses the process boundary.
 *
 * Main validates what comes in, the renderer parses what comes back. A typo in a
 * channel name is a compile error instead of a runtime mystery, and a server-side
 * field rename becomes a loud parse failure instead of an empty list.
 */

export const capabilitiesSchema = z.object({
  photoLibrary: z.boolean(),
  photoBrowse: z.boolean(),
  photoBackup: z.boolean(),
  files: z.boolean(),
  apps: z.boolean(),
  appStore: z.boolean(),
  systemPower: z.boolean(),
  zerotier: z.boolean(),
  backup: z.boolean(),
  routes: z.array(z.string()).readonly(),
})

export const probeResultSchema = z.object({
  host: z.string(),
  reachable: z.boolean(),
  latencyMs: z.number().nullable(),
  failure: z.enum(['refused', 'timeout', 'dns', 'unexpected-status']).nullable(),
  httpStatus: z.number().nullable(),
})

export const discoveredDeviceSchema = z.object({
  host: z.string(),
  name: z.string(),
  port: z.number(),
  txt: z.record(z.string(), z.string()),
})

export const secretStoreStatusSchema = z.object({
  backend: z.enum([
    'gnome_libsecret',
    'kwallet',
    'kwallet5',
    'kwallet6',
    'basic_text',
    'unknown',
  ]),
  encryptionAvailable: z.boolean(),
  plaintextRisk: z.boolean(),
})

export const appErrorSchema = z.object({
  kind: z.enum([
    'refused',
    'timeout',
    'dns',
    'unexpected-status',
    'malformed-response',
    'unauthorized',
    'forbidden-path',
    'capability-missing',
    'cancelled',
    'internal',
  ]),
  message: z.string(),
  i18nKey: z.string(),
  context: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
})

/** Every channel answers with this envelope — a failure can never look like success. */
export const envelope = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ])

const hostPort = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(80),
})

export const CHANNELS = {
  discoveryScan: 'discovery:scan',
  transportProbe: 'transport:probe',
  deviceCapabilities: 'device:capabilities',
  secretsStatus: 'secrets:status',
  appInfo: 'app:info',
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

/** request/response schema per channel. Keep both sides here, never inline. */
export const channelSchemas = {
  [CHANNELS.discoveryScan]: {
    request: z.object({ timeoutMs: z.number().int().min(500).max(15_000).default(3_000) }),
    response: envelope(z.array(discoveredDeviceSchema)),
  },
  [CHANNELS.transportProbe]: {
    request: hostPort,
    response: envelope(probeResultSchema),
  },
  [CHANNELS.deviceCapabilities]: {
    request: hostPort,
    response: envelope(capabilitiesSchema),
  },
  [CHANNELS.secretsStatus]: {
    request: z.object({}),
    response: envelope(secretStoreStatusSchema),
  },
  [CHANNELS.appInfo]: {
    request: z.object({}),
    response: envelope(
      z.object({
        version: z.string(),
        electron: z.string(),
        platform: z.string(),
        locale: z.string(),
      }),
    ),
  },
} as const

export type ChannelSchemas = typeof channelSchemas
export type RequestOf<C extends ChannelName> = z.input<ChannelSchemas[C]['request']>
export type ResponseOf<C extends ChannelName> = z.output<ChannelSchemas[C]['response']>
