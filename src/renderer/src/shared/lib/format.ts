/**
 * Formatting helpers, all locale-aware through `Intl`.
 *
 * Deliberately not hand-rolled: a hardcoded `.` thousands separator or an `MM/DD` date is
 * wrong in most of the 28 languages this client ships, and it is the kind of wrongness
 * nobody reports — they just read the number incorrectly.
 *
 * 🔴 Every function goes through `bcp47` first. i18next carries locales as `de_DE` (the form
 * ZimaOS itself uses for its catalogues), while `Intl` demands `de-DE` and **throws**
 * `RangeError: Invalid language tag` otherwise. Measured: that throw blanked the whole window
 * — one component threw during render, React unmounted the tree, and the report could only
 * say `visibleText: ''`. Normalising at each call site was the first fix and the wrong one:
 * `formatDateTime` had it, `formatBytes` did not, and only the second one was on the screen
 * that crashed. So the conversion lives in ONE place that every formatter must pass through.
 */

const bcp47 = (locale: string): string => locale.replace('_', '-')

/**
 * Bytes in binary units, because that is what a NAS reports.
 *
 * 0 stays "0 B" rather than becoming an em dash: zero is a measurement, and blanking it
 * would make an empty volume look unreadable.
 */
export const formatBytes = (bytes: number, locale: string): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value < 10 ? 1 : 0
  return `${new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}

/** Date and time of day, short form, in the user's locale. */
export const formatDateTime = (epochMs: number, locale: string): string => {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—'
  return new Intl.DateTimeFormat(bcp47(locale), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(epochMs))
}

/** Time of day only — used for "as of 09:14" on cached data. */
export const formatTime = (epochMs: number, locale: string): string => {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—'
  return new Intl.DateTimeFormat(bcp47(locale), { timeStyle: 'short' }).format(new Date(epochMs))
}

export const formatPercent = (fraction: number, locale: string): string =>
  new Intl.NumberFormat(bcp47(locale), { maximumFractionDigits: 0 }).format(fraction)

/** The last segment of a device path, for a breadcrumb. */
export const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/**
 * Breadcrumb trail for an absolute device path.
 *
 * Returns each ancestor with its full path, so a click can navigate straight there instead
 * of walking up one level at a time.
 */
export const breadcrumbs = (path: string): readonly { name: string; path: string }[] => {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  const trail: { name: string; path: string }[] = []
  let current = ''
  for (const segment of segments) {
    current = `${current}/${segment}`
    trail.push({ name: segment, path: current })
  }
  return trail
}

/** Parent directory of a path, or null at the root — null means "no up button". */
export const parentPath = (path: string): string | null => {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 1) return null
  return `/${segments.slice(0, -1).join('/')}`
}
