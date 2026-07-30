import { z } from 'zod'
import { CHANNELS, type ChannelName } from './channels'

export { CHANNELS }
export type { ChannelName }

/**
 * The IPC contract — one schema per channel, the single source of truth for what
 * crosses the process boundary.
 *
 * Main validates what comes in, the renderer parses what comes back. A typo in a
 * channel name is a compile error instead of a runtime mystery, and a server-side
 * field rename becomes a loud parse failure instead of an empty list.
 */

/**
 * ZeroTier state as measured on the device, not derived from the route table.
 * `'unknown'` is a real member of the union: it says nobody has asked yet, which is
 * different from the device answering "no".
 */
export const zerotierStateSchema = z.union([
  z.literal('unknown'),
  z.object({
    kind: z.enum(['online', 'offline']),
    networkId: z.string(),
    ip: z.string().nullable(),
    networkName: z.string().nullable(),
  }),
  z.object({ kind: z.enum(['not-running', 'absent']) }),
  z.object({ kind: z.literal('unreachable'), reason: z.string() }),
])

export const capabilitiesSchema = z.object({
  photoLibrary: z.boolean(),
  photoBrowse: z.boolean(),
  photoBackup: z.boolean(),
  files: z.boolean(),
  apps: z.boolean(),
  appStore: z.boolean(),
  systemPower: z.boolean(),
  zerotier: zerotierStateSchema,
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
    'invalid-credentials',
    'parameters',
    'plaintext-risk',
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

export const sessionSummarySchema = z.object({
  deviceId: z.string(),
  displayName: z.string(),
  host: z.string(),
  port: z.number(),
  kind: z.enum(['lan', 'direct', 'remote-id']),
  username: z.string(),
  role: z.string(),
  accessExpiresAtMs: z.number(),
  capabilities: capabilitiesSchema.nullable(),
})

export const deviceAddressSchema = z.object({
  kind: z.enum(['lan', 'direct', 'remote-id']),
  host: z.string(),
  port: z.number(),
  priority: z.number(),
})

export const deviceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  addresses: z.array(deviceAddressSchema).readonly(),
  lastSeenIso: z.string().nullable(),
  capabilities: capabilitiesSchema.nullable(),
})


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
  [CHANNELS.secretsConsent]: {
    request: z.object({ granted: z.boolean() }),
    response: envelope(secretStoreStatusSchema),
  },
  [CHANNELS.sessionSignIn]: {
    request: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535).default(80),
      kind: z.enum(['lan', 'direct', 'remote-id']).default('direct'),
      username: z.string().min(1),
      password: z.string().min(1),
      displayName: z.string().optional(),
    }),
    response: envelope(sessionSummarySchema),
  },
  [CHANNELS.sessionResume]: {
    request: z.object({ deviceId: z.string().min(1) }),
    response: envelope(sessionSummarySchema),
  },
  [CHANNELS.sessionCurrent]: {
    request: z.object({}),
    response: envelope(sessionSummarySchema),
  },
  [CHANNELS.sessionSignOut]: {
    request: z.object({}),
    response: envelope(z.object({ signedOut: z.literal(true) })),
  },
  [CHANNELS.devicesList]: {
    request: z.object({}),
    response: envelope(
      z.object({
        devices: z.array(deviceSchema).readonly(),
        activeDeviceId: z.string().nullable(),
      }),
    ),
  },
  [CHANNELS.devicesSetActive]: {
    request: z.object({ deviceId: z.string().min(1) }),
    response: envelope(deviceSchema),
  },
  [CHANNELS.devicesSetPriorities]: {
    request: z.object({
      deviceId: z.string().min(1),
      orderedAddressKeys: z.array(z.string()).min(1),
    }),
    response: envelope(deviceSchema),
  },
  [CHANNELS.devicesForget]: {
    request: z.object({ deviceId: z.string().min(1) }),
    response: envelope(z.object({ forgotten: z.literal(true) })),
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
