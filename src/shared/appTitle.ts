import type { AppTile } from './domain'

/**
 * Picks the title for a locale.
 *
 * Order: the user's exact locale (`de_de`), then a custom name the owner set on the device,
 * then English, then the container name. Never an empty string — an app tile with no label
 * is unusable, and the container name is a real fact rather than a placeholder.
 *
 * 🔴 One function for both processes (2026-10-08). The Apps screen had its own copy without
 * the blank-skip and without the any-key fallback, so fixing the main-process one left the
 * visible tile nameless — and `open-webui-ollama`, whose titles sit under `en_US`, showed
 * its container name instead of its title.
 */
export const preferredTitle = (
  tile: Pick<AppTile, 'title' | 'name'>,
  locale: string,
): string => {
  const key = locale.toLowerCase().replace('-', '_')
  // `??` alone let an EMPTY title through: measured 2026-10-08, an app answering
  // `title: {custom: "", en_us: "newt"}` rendered as a tile without a name. Blank entries
  // are skipped like missing ones, so the promise above holds.
  const usable = (value: string | undefined): string | undefined =>
    value !== undefined && value.trim().length > 0 ? value : undefined
  return (
    usable(tile.title[key]) ??
    usable(tile.title['custom']) ??
    usable(tile.title['en_us']) ??
    Object.values(tile.title).map(usable).find((value) => value !== undefined) ??
    tile.name
  )
}
