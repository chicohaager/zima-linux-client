import { describe, expect, it } from 'vitest'
import type { AppTile } from '@shared/domain'
import { preferredTitle } from '../apps'

/*
 * Measured 2026-10-08 on ZimaOS 1.8.0-beta2: an app answered `title: {custom: "", en_us:
 * "newt"}` and its tile rendered without a name — `??` passes an empty string through.
 */
const tile = (title: Record<string, string>): AppTile => ({
  id: 'x',
  name: 'container-name',
  title,
  iconUrl: '',
  status: 'running',
  installStatus: 'completed',
  port: null,
  scheme: 'http',
  index: '',
  appType: 'v2app',
})

describe('preferredTitle', () => {
  it('skips an empty custom title', () => {
    expect(preferredTitle(tile({ custom: '', en_us: 'newt' }), 'de-DE')).toBe('newt')
  })

  it('skips a blank locale title and keeps the custom one', () => {
    expect(preferredTitle(tile({ de_de: '  ', custom: 'Mein Name' }), 'de-DE')).toBe('Mein Name')
  })

  it('falls back to any non-empty title, then to the container name', () => {
    expect(preferredTitle(tile({ en_US: 'Open WebUI', custom: '' }), 'de-DE')).toBe('Open WebUI')
    expect(preferredTitle(tile({ custom: '', en_us: '' }), 'de-DE')).toBe('container-name')
  })

  it('reads titles stored under an upper-case locale key', () => {
    // Measured: `open-webui-ollama` carries `{en_GB, en_US, ja_JP, zh_CN}` only.
    expect(preferredTitle(tile({ en_GB: 'Open WebUI', en_US: 'Open WebUI' }), 'de_de')).toBe('Open WebUI')
  })

  it('still prefers the exact locale', () => {
    expect(preferredTitle(tile({ de_de: 'Haushaltskasse', en_us: 'Household', custom: 'X' }), 'de-DE')).toBe(
      'Haushaltskasse',
    )
  })
})
