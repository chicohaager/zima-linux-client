import type { z } from 'zod'
import { CHANNELS, type ChannelName } from './channels'
import { coreChannelSchemas } from './contractCore'
import { featureChannelSchemas } from './contractFeatures'

/**
 * The IPC contract — the only module main, preload and renderer should import.
 *
 * It is the merge of two halves: `contractCore` (discovery, session, devices, secrets) and
 * `contractFeatures` (files, photos, apps, system, ZeroTier, migration). Split purely for
 * readability; the guarantees are unchanged.
 *
 * `channelSchemas` is exhaustive over `ChannelName` by construction: the type below fails to
 * compile if a channel is added to `channels.ts` without a schema. That matters because the
 * IPC handler looks its schema up by channel name at runtime — a missing entry would be
 * `undefined.safeParse(…)`, a crash inside the boundary whose job is to prevent crashes.
 */

export { CHANNELS }
export type { ChannelName }
export * from './contractCore'
export * from './contractFeatures'
export * from './contractSchemas'

export const channelSchemas = {
  ...coreChannelSchemas,
  ...featureChannelSchemas,
} satisfies Record<
  ChannelName,
  { request: z.ZodTypeAny; response: z.ZodTypeAny }
>

export type ChannelSchemas = typeof channelSchemas
export type RequestOf<C extends ChannelName> = z.input<ChannelSchemas[C]['request']>
export type ResponseOf<C extends ChannelName> = z.output<ChannelSchemas[C]['response']>
