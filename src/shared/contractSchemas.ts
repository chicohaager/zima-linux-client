import { z } from 'zod'

/**
 * The value schemas the feature channels exchange — files, tasks, photos, apps, device
 * figures, backup status, legacy profiles.
 *
 * Separate from the channel map in `contractFeatures.ts` so both stay readable: this file
 * answers "what does a file entry look like on the wire", that one answers "which channel
 * carries it". Both are re-exported from `contract.ts`.
 */

export const fileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDir: z.boolean(),
  size: z.number(),
  modifiedMs: z.number(),
})

export const directoryPageSchema = z.object({
  path: z.string(),
  entries: z.array(fileEntrySchema).readonly(),
  total: z.number(),
  index: z.number(),
  size: z.number(),
})

export const fileTaskSchema = z.object({
  id: z.number(),
  type: z.string(),
  status: z.string(),
  errorMessage: z.string().nullable(),
  createdUtc: z.number(),
  finishedUtc: z.number(),
})

export const trashEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  rawPath: z.string(),
  size: z.number(),
  isDir: z.boolean(),
  deletedAtMs: z.number(),
})

export const photoAssetSchema = z.object({
  fileId: z.string(),
  path: z.string(),
  width: z.number(),
  height: z.number(),
  captureTsMs: z.number(),
  mediaType: z.string(),
  isFavorite: z.boolean(),
})

export const photoProgressSchema = z.object({
  status: z.string(),
  totalImages: z.number(),
  totalVideos: z.number(),
  processedImages: z.number(),
  processedVideos: z.number(),
  pendingImages: z.number(),
  pendingVideos: z.number(),
  stages: z
    .array(
      z.object({
        kind: z.string(),
        label: z.string(),
        percentage: z.number(),
        status: z.string(),
      }),
    )
    .readonly(),
  /**
   * Whether semantic search can answer. Must be listed here, not only in the domain type:
   * a `z.object` strips fields it does not name, so a value added in the main process
   * reaches the renderer as `undefined` with nothing failing anywhere — no type error, no
   * parse error, just a feature that quietly does not arrive.
   */
  semanticSearch: z.object({
    ready: z.boolean(),
    enabled: z.boolean(),
    missing: z.array(z.string()).readonly(),
    status: z.string(),
  }),
})

export const appTileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The app's own title per locale, e.g. `{en_us:"Photos", de_de:"Fotos"}`. */
  title: z.record(z.string(), z.string()),
  status: z.string(),
  installStatus: z.string(),
  port: z.number().nullable(),
  scheme: z.string(),
  index: z.string(),
  appType: z.string(),
  /** `zima-media://appicon/…` when the device serves the icon, null when it does not. */
  iconUrl: z.string().nullable(),
  /** Address of the app's web UI as reachable from this client, null when it has none. */
  webUiUrl: z.string().nullable(),
})

export const utilizationSchema = z.object({
  cpuPercent: z.number(),
  cpuModel: z.string(),
  cpuCores: z.number(),
  cpuTemperature: z.number().nullable(),
  cpuPowerWatt: z.number().nullable(),
  cpuEnergyMicrojoules: z.number().nullable(),
  cpuPowerTimestamp: z.number().nullable(),
  memoryTotal: z.number(),
  memoryUsed: z.number(),
  memoryPercent: z.number(),
  systemDiskSize: z.number(),
  systemDiskUsed: z.number(),
  systemDiskHealthy: z.boolean(),
})

export const deviceInfoSchema = z.object({
  name: z.string(),
  model: z.string(),
  osVersion: z.string(),
  arch: z.string(),
  cpuModel: z.string(),
  cpuCores: z.number(),
  memoryTotal: z.number(),
})

export const storageVolumeSchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.string(),
  sizeBytes: z.number(),
  usedBytes: z.number(),
  healthy: z.boolean(),
})

/**
 * State of the foreground photo backup.
 *
 * `skipped` carries a reason per file, because "backup finished" while three files were
 * quietly left out is the failure mode this feature has to avoid: the user believes the
 * photos are on the device.
 */
export const backupStatusSchema = z.object({
  phase: z.enum(['idle', 'scanning', 'uploading', 'done', 'cancelled', 'failed']),
  targetPath: z.string(),
  total: z.number(),
  uploaded: z.number(),
  skipped: z.number(),
  failed: z.number(),
  bytesSent: z.number(),
  bytesTotal: z.number(),
  currentFile: z.string().nullable(),
  startedAtMs: z.number().nullable(),
  finishedAtMs: z.number().nullable(),
  /** Per-file outcomes that were not a plain success — with the reason, never a bare count. */
  notes: z
    .array(
      z.object({
        file: z.string(),
        outcome: z.enum(['skipped-duplicate', 'skipped-unsupported', 'failed']),
        detail: z.string(),
      }),
    )
    .readonly(),
})

export const legacyProfileSchema = z.object({
  /** Config directory of the old client, e.g. `~/.config/zima-client`. */
  directory: z.string(),
  host: z.string().nullable(),
  username: z.string().nullable(),
  /** How many saved connections were found in that profile. */
  connections: z.number(),
  backupJobs: z.number(),
})

export const zerotierRuntimeSchema = z.object({
  /** Whether a local zerotier-one is usable at all, and where it came from. */
  daemon: z.enum(['system', 'bundled', 'absent']),
  running: z.boolean(),
  /** Our own node address inside ZeroTier, null until the daemon reports one. */
  nodeId: z.string().nullable(),
  networks: z
    .array(
      z.object({
        networkId: z.string(),
        name: z.string(),
        status: z.string(),
        /** PUBLIC / PRIVATE. Must be listed: a z.object silently drops what it omits. */
        type: z.string(),
        assignedAddresses: z.array(z.string()).readonly(),
      }),
    )
    .readonly(),
  /** Set when the state could not be established — with the reason, never assumed 'off'. */
  problem: z.string().nullable(),
})

/**
 * Local Tailscale state, as read from `tailscale status --json`.
 *
 * `backendState` stays a free string rather than an enum: it is the daemon's own word
 * (Running, Stopped, NeedsLogin, NoState, Starting) and pinning it to the values seen on
 * one machine would turn an unmeasured future value into a parse error on someone else's.
 */
export const tailscaleRuntimeSchema = z.object({
  installed: z.boolean(),
  backendState: z.string().nullable(),
  selfAddresses: z.array(z.string()).readonly(),
  magicDnsSuffix: z.string().nullable(),
  tailnetName: z.string().nullable(),
  peers: z
    .array(
      z.object({
        hostName: z.string(),
        addresses: z.array(z.string()).readonly(),
        online: z.boolean(),
        os: z.string(),
      }),
    )
    .readonly(),
  /** "Not installed" and "could not ask" are different — only the second sets this. */
  problem: z.string().nullable(),
})

