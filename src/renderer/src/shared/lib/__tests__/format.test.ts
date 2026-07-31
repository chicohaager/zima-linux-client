import { describe, expect, it } from 'vitest'
import {
  basename,
  breadcrumbs,
  formatBytes,
  formatDateTime,
  formatPercent,
  formatTime,
  parentPath,
} from '../format'

/**
 * These tests exist because of a real crash, and the first one is the guard against it.
 *
 * i18next hands out locales as `de_DE`; `Intl` requires `de-DE` and throws
 * `RangeError: Invalid language tag` otherwise. That throw happened inside a render, React
 * unmounted the tree, and the window went **blank** — no message anywhere. The unit tests
 * that existed at the time all passed, because none of them ever passed an underscore locale:
 * the test world had simplified away the only input shape the app actually uses.
 */

const UNDERSCORE_LOCALES = ['de_DE', 'en_US', 'pt_BR', 'zh_CN', 'ml_IN'] as const

describe('format helpers accept the locale form the app really uses', () => {
  it.each(UNDERSCORE_LOCALES)('formats bytes for %s without throwing', (locale) => {
    expect(() => formatBytes(1_536, locale)).not.toThrow()
    expect(formatBytes(1_536, locale)).toContain('KiB')
  })

  it.each(UNDERSCORE_LOCALES)('formats a date for %s without throwing', (locale) => {
    expect(() => formatDateTime(1_785_000_000_000, locale)).not.toThrow()
    expect(() => formatTime(1_785_000_000_000, locale)).not.toThrow()
  })

  it.each(UNDERSCORE_LOCALES)('formats a percentage for %s without throwing', (locale) => {
    expect(() => formatPercent(42.4, locale)).not.toThrow()
  })

  /**
   * The negative control. Without it, a helper that quietly caught its own RangeError and
   * returned a placeholder would pass every test above while showing "—" to the user.
   */
  it('still rejects a genuinely invalid tag instead of silently swallowing it', () => {
    expect(() => formatBytes(1_024, 'not a locale at all')).toThrow()
  })
})

describe('formatBytes', () => {
  it('keeps zero as a measurement rather than blanking it', () => {
    expect(formatBytes(0, 'en_US')).toBe('0 B')
  })

  it('reports a negative or non-finite size as unknown', () => {
    expect(formatBytes(-1, 'en_US')).toBe('—')
    expect(formatBytes(Number.NaN, 'en_US')).toBe('—')
  })

  it('climbs to the right binary unit', () => {
    expect(formatBytes(1_024, 'en_US')).toBe('1 KiB')
    expect(formatBytes(5 * 1024 * 1024, 'en_US')).toBe('5 MiB')
    expect(formatBytes(3 * 1024 ** 4, 'en_US')).toBe('3 TiB')
  })
})

describe('formatDateTime', () => {
  it('treats epoch zero as "no date" — the device sends 0 for "never"', () => {
    expect(formatDateTime(0, 'en_US')).toBe('—')
  })
})

describe('path helpers', () => {
  it('builds a breadcrumb with a full path per segment', () => {
    expect(breadcrumbs('/media/ZimaOS-HD/Photos')).toEqual([
      { name: 'media', path: '/media' },
      { name: 'ZimaOS-HD', path: '/media/ZimaOS-HD' },
      { name: 'Photos', path: '/media/ZimaOS-HD/Photos' },
    ])
  })

  it('has no parent at the top level, so no up button is offered', () => {
    expect(parentPath('/media')).toBeNull()
    expect(parentPath('/')).toBeNull()
  })

  it('finds the parent of a nested path', () => {
    expect(parentPath('/media/ZimaOS-HD/Photos')).toBe('/media/ZimaOS-HD')
  })

  it('reads the last segment as the name', () => {
    expect(basename('/media/ZimaOS-HD/holiday.jpg')).toBe('holiday.jpg')
  })
})
