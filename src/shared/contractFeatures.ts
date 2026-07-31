import { z } from 'zod'
import { CHANNELS } from './channels'
import { appErrorSchema } from './contractCore'
import {
  appTileSchema,
  backupStatusSchema,
  deviceInfoSchema,
  directoryPageSchema,
  fileEntrySchema,
  fileTaskSchema,
  legacyProfileSchema,
  photoAssetSchema,
  photoProgressSchema,
  storageVolumeSchema,
  trashEntrySchema,
  utilizationSchema,
  tailscaleRuntimeSchema,
  zerotierRuntimeSchema,
} from './contractSchemas'

/**
 * IPC schemas for the feature channels — files, photos, apps, system, ZeroTier, migration.
 *
 * Split off `contract.ts` to keep every file readable; the merge happens there. Same rules
 * apply: one schema per channel, both directions, and every answer inside the envelope so a
 * failure can never arrive looking like success.
 */

const envelope = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ])

/** A device path. Non-empty and absolute — a relative path would resolve server-side. */
const devicePath = z.string().min(1).startsWith('/')

const zerotierJoinRequest = z.object({
  /** ZeroTier network id: exactly 16 hex characters. Validated here, not on the device. */
  networkId: z.string().regex(/^[0-9a-fA-F]{16}$/),
})

export const featureChannelSchemas = {
  [CHANNELS.devicesPower]: {
    request: z.object({
      deviceId: z.string().min(1),
      action: z.enum(['restart', 'off']),
      /** The user must have confirmed in the UI; the main process records that they did. */
      confirmed: z.literal(true),
    }),
    response: envelope(z.object({ requested: z.enum(['restart', 'off']) })),
  },

  [CHANNELS.filesList]: {
    request: z.object({
      path: devicePath,
      index: z.number().int().min(1).default(1),
      size: z.number().int().min(1).max(1_000).default(200),
      sort: z.enum(['name', 'size', 'modified']).default('name'),
      direction: z.enum(['asc', 'desc']).default('asc'),
    }),
    response: envelope(directoryPageSchema),
  },
  [CHANNELS.filesSearch]: {
    request: z.object({
      root: devicePath,
      needle: z.string().min(1).max(200),
      maxEntries: z.number().int().min(100).max(20_000).default(4_000),
    }),
    response: envelope(
      z.object({
        hits: z.array(fileEntrySchema).readonly(),
        scanned: z.number(),
        /** True when the walk hit its budget — so "8 hits" is not read as "8 in total". */
        truncated: z.boolean(),
      }),
    ),
  },
  [CHANNELS.filesCreateFolder]: {
    request: z.object({ parent: devicePath, name: z.string().min(1).max(255) }),
    response: envelope(z.object({ path: z.string() })),
  },
  [CHANNELS.filesTransfer]: {
    request: z.object({
      kind: z.enum(['copy', 'move']),
      sources: z.array(devicePath).min(1).max(500),
      destination: devicePath,
      onConflict: z.enum(['skip', 'rename', 'overwrite']).default('rename'),
    }),
    response: envelope(fileTaskSchema),
  },
  [CHANNELS.filesTasks]: {
    request: z.object({}),
    response: envelope(z.array(fileTaskSchema).readonly()),
  },
  [CHANNELS.filesTrashMove]: {
    request: z.object({ paths: z.array(devicePath).min(1).max(500) }),
    response: envelope(
      z.array(z.object({ path: z.string(), status: z.string() })).readonly(),
    ),
  },
  [CHANNELS.filesTrashList]: {
    request: z.object({}),
    response: envelope(z.array(trashEntrySchema).readonly()),
  },
  [CHANNELS.filesTrashRestore]: {
    request: z.object({ paths: z.array(z.string().min(1)).min(1).max(500) }),
    response: envelope(z.object({ restored: z.number() })),
  },
  [CHANNELS.filesPins]: {
    request: z.object({}),
    response: envelope(
      z.array(z.object({ name: z.string(), path: z.string(), type: z.string() })).readonly(),
    ),
  },
  [CHANNELS.filesDownload]: {
    request: z.object({ path: devicePath }),
    response: envelope(
      z.object({
        /** Where it landed locally. Null when the user cancelled the save dialog. */
        savedTo: z.string().nullable(),
        bytes: z.number(),
      }),
    ),
  },
  [CHANNELS.filesUpload]: {
    request: z.object({ destination: devicePath }),
    response: envelope(
      z.object({ uploaded: z.number(), failed: z.number(), cancelled: z.boolean() }),
    ),
  },

  [CHANNELS.photosGallery]: {
    request: z.object({
      limit: z.number().int().min(1).max(200).default(60),
      cursor: z.string().nullable().default(null),
    }),
    response: envelope(
      z.object({
        assets: z.array(photoAssetSchema).readonly(),
        total: z.number(),
        nextCursor: z.string().nullable(),
      }),
    ),
  },
  [CHANNELS.photosFolderGrid]: {
    request: z.object({
      path: devicePath,
      index: z.number().int().min(1).default(1),
      size: z.number().int().min(1).max(500).default(120),
    }),
    response: envelope(
      z.object({
        path: z.string(),
        entries: z.array(fileEntrySchema).readonly(),
        total: z.number(),
        /** Directories in the same folder, so the grid can be navigated without the Files tab. */
        folders: z.array(fileEntrySchema).readonly(),
      }),
    ),
  },
  [CHANNELS.photosProgress]: {
    request: z.object({}),
    response: envelope(photoProgressSchema),
  },
  [CHANNELS.photosSearch]: {
    request: z.object({ query: z.string().min(1).max(300) }),
    response: envelope(
      z.object({
        hits: z
          .array(
            z.object({
              fileId: z.string(),
              path: z.string(),
              name: z.string(),
              type: z.string(),
              score: z.number(),
            }),
          )
          .readonly(),
        total: z.number(),
        tookMs: z.number(),
      }),
    ),
  },
  [CHANNELS.photosPickFolders]: {
    request: z.object({}),
    response: envelope(z.object({ folders: z.array(z.string()).readonly() })),
  },
  [CHANNELS.photosBackupStart]: {
    request: z.object({
      sources: z.array(z.string().min(1)).min(1).max(50),
      destination: devicePath,
    }),
    response: envelope(backupStatusSchema),
  },
  [CHANNELS.photosBackupStatus]: {
    request: z.object({}),
    response: envelope(backupStatusSchema),
  },
  [CHANNELS.photosBackupCancel]: {
    request: z.object({}),
    response: envelope(backupStatusSchema),
  },

  [CHANNELS.appsList]: {
    request: z.object({}),
    response: envelope(
      z.object({
        apps: z.array(appTileSchema).readonly(),
        /** Epoch ms of the data. Set when it came from the cache, null when it is fresh. */
        cachedAtMs: z.number().nullable(),
      }),
    ),
  },
  [CHANNELS.appsSetRunning]: {
    request: z.object({ id: z.string().min(1), running: z.boolean() }),
    response: envelope(z.object({ id: z.string(), running: z.boolean() })),
  },
  [CHANNELS.appsOpenWebUi]: {
    request: z.object({ id: z.string().min(1), external: z.boolean().default(false) }),
    response: envelope(z.object({ opened: z.enum(['window', 'browser']) })),
  },

  [CHANNELS.systemUtilization]: {
    request: z.object({}),
    response: envelope(utilizationSchema),
  },
  [CHANNELS.systemDeviceInfo]: {
    request: z.object({}),
    response: envelope(deviceInfoSchema),
  },
  [CHANNELS.systemVolumes]: {
    request: z.object({}),
    response: envelope(z.array(storageVolumeSchema).readonly()),
  },

  [CHANNELS.zerotierState]: {
    request: z.object({}),
    response: envelope(zerotierRuntimeSchema),
  },
  [CHANNELS.zerotierJoin]: {
    request: zerotierJoinRequest,
    response: envelope(zerotierRuntimeSchema),
  },
  [CHANNELS.zerotierLeave]: {
    request: zerotierJoinRequest,
    response: envelope(zerotierRuntimeSchema),
  },
  [CHANNELS.zerotierProvision]: {
    request: z.object({}),
    response: envelope(
      z.object({
        installed: z.boolean(),
        capable: z.boolean().nullable(),
        path: z.string(),
        /** The one command that grants the capability — shown, never run for the user. */
        command: z.string(),
        problem: z.string().nullable(),
      }),
    ),
  },

  [CHANNELS.tailscaleState]: {
    request: z.object({}),
    response: envelope(tailscaleRuntimeSchema),
  },

  [CHANNELS.connectRemoteId]: {
    request: z.object({ remoteId: z.string().min(1).max(32) }),
    response: envelope(
      z.object({
        host: z.string(),
        port: z.number(),
        /** Round-trip time of the probe that proved this address answers as ZimaOS. */
        latencyMs: z.number().nullable(),
        networkName: z.string(),
      }),
    ),
  },

  [CHANNELS.legacyScan]: {
    request: z.object({}),
    response: envelope(z.array(legacyProfileSchema).readonly()),
  },
  [CHANNELS.legacyImport]: {
    request: z.object({ directory: z.string().min(1) }),
    response: envelope(z.object({ imported: z.number(), skipped: z.number() })),
  },

  [CHANNELS.logsOpenFolder]: {
    request: z.object({}),
    response: envelope(z.object({ folder: z.string() })),
  },
} as const
