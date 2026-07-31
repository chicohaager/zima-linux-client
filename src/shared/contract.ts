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

/**
 * What the RENDERER sends — the schema's **input** type.
 *
 * Optional wherever the schema has a `.default()`: the point of a default is that the caller
 * may leave the field out.
 */
export type RequestOf<C extends ChannelName> = z.input<ChannelSchemas[C]['request']>

/**
 * What the HANDLER receives — the schema's **output** type.
 *
 * 🔴 Not the same type, and the difference is exactly the defaults. `filesList` declares
 * `index: z.number().default(1)`: on the way in the field may be absent, by the time the
 * handler sees `parsed.data` zod has filled it, so it is present. Typing a handler with the
 * input type claims a value can be `undefined` that never is — and the compiler then demands
 * pointless guards, or (worse) the guard gets written and hides that the default stopped
 * working. Measured 2026-07-31: typing `handle()` with `RequestOf` produced five errors, all
 * of them this mix-up and none of them a real defect.
 */
export type HandlerInput<C extends ChannelName> = z.output<ChannelSchemas[C]['request']>

export type ResponseOf<C extends ChannelName> = z.output<ChannelSchemas[C]['response']>
