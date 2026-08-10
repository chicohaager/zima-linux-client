// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { appError, NO_PATH_ANSWERED } from '@shared/result'
import { errorMessage } from '../ipc'

/**
 * An error sentence must arrive with its values filled in.
 *
 * 🔴 Seen on a real desktop on 2026-08-10, in the shipped 2.0.0-alpha.2:
 *
 *     Kein gespeicherter Verbindungsweg hat geantwortet ({{paths}}).
 *
 * Twenty call sites wrote `t(error.i18nKey)` and handed over no values, while two catalogue
 * entries carry placeholders. The values were never missing — `error.context` had them, and
 * the technical line right underneath was printing them. They were simply not passed to the
 * translator.
 *
 * Nothing caught it: the i18n gate compares KEYS across catalogues and is blind to whether a
 * placeholder ever gets a value; the unit tests never rendered this branch; the tour scans
 * for raw keys (`error.foo`), which `{{paths}}` is not. So the guard is written at the level
 * where the defect was visible — the rendered text — and in two shapes:
 *
 *   1. the real catalogue, the real translator, the real component path
 *   2. a sweep over every catalogue entry that HAS a placeholder, so a new one added
 *      tomorrow is covered without anyone remembering this file
 */

const catalogue = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'src/renderer/src/i18n/locales', `${name}.json`), 'utf8'),
  ) as Record<string, unknown>

const i18n = i18next.createInstance()
await i18n.init({
  lng: 'de',
  resources: { de: { translation: catalogue('de_DE') }, en: { translation: catalogue('en_US') } },
  interpolation: { escapeValue: false },
})

const Shown = ({ error }: { error: Parameters<typeof errorMessage>[1] }): React.JSX.Element => {
  const { t } = useTranslation()
  return <p data-testid="msg">{errorMessage(t, error)}</p>
}

const renderWith = (error: Parameters<typeof errorMessage>[1]): string => {
  // The sweep below renders many times in one test; without this they pile up in the same
  // document and `getByTestId` finds several.
  cleanup()
  render(
    <I18nextProvider i18n={i18n}>
      <Shown error={error} />
    </I18nextProvider>,
  )
  return screen.getByTestId('msg').textContent ?? ''
}

describe('errorMessage', () => {
  it('fills the placeholder of the failure that shipped broken', () => {
    const text = renderWith(
      appError('timeout', 'no stored path answered', NO_PATH_ANSWERED, {
        deviceId: 'name:ZimaOS',
        paths: '192.0.2.7=timeout',
      }),
    )

    expect(text).toContain('192.0.2.7=timeout')
    expect(text).not.toContain('{{')
  })

  it('fills the placeholder of the other key that carries one', () => {
    const text = renderWith(
      appError('unexpected-status', 'HTTP 503', 'error.unexpectedStatus', { status: 503 }),
    )

    expect(text).toContain('503')
    expect(text).not.toContain('{{')
  })

  it('leaves the hole visible when the value really is missing', () => {
    // Deliberate: i18next keeps `{{paths}}` when nothing is supplied. A hole shows there is
    // a hole; a silent blank would read as a finished sentence.
    const text = renderWith(appError('timeout', 'no context at all', NO_PATH_ANSWERED))

    expect(text).toContain('{{paths}}')
  })

  it('falls back to a translated sentence for a null error', () => {
    const text = renderWith(null)

    expect(text.length).toBeGreaterThan(0)
    expect(text).not.toContain('error.')
  })
})

describe('every error key with a placeholder', () => {
  /** `error.*` entries of en_US that contain at least one `{{name}}`. */
  const withPlaceholders = (): { key: string; names: string[] }[] => {
    const errors = catalogue('en_US')['error'] as Record<string, string>
    return Object.entries(errors)
      .map(([key, value]) => ({
        key: `error.${key}`,
        names: [...value.matchAll(/{{(\w+)}}/g)].map((m) => m[1] ?? ''),
      }))
      .filter((entry) => entry.names.length > 0)
  }

  it('is covered by this file, and there are some to cover', () => {
    const found = withPlaceholders()
    // Without this the suite would pass by finding nothing — the failure mode of every
    // guard that iterates over a discovered set.
    expect(found.length).toBeGreaterThanOrEqual(2)

    for (const { key, names } of found) {
      const context = Object.fromEntries(names.map((name) => [name, `value-of-${name}`]))
      const text = renderWith(appError('internal', 'sweep', key, context))
      expect(text, `${key} rendered with a hole`).not.toContain('{{')
      for (const name of names) expect(text).toContain(`value-of-${name}`)
    }
  })

  it('is complete in every catalogue — no language may lose a placeholder', () => {
    const names = readdirSync(join(process.cwd(), 'src/renderer/src/i18n/locales'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''))
    expect(names.length).toBe(28)

    const expected = new Map(withPlaceholders().map((e) => [e.key, new Set(e.names)]))
    const missing: string[] = []

    for (const language of names) {
      const errors = catalogue(language)['error'] as Record<string, string>
      for (const [key, wanted] of expected) {
        const value = errors[key.slice('error.'.length)]
        if (value === undefined) {
          missing.push(`${language}: ${key} absent`)
          continue
        }
        const has = new Set([...value.matchAll(/{{(\w+)}}/g)].map((m) => m[1] ?? ''))
        for (const name of wanted) {
          // A translation that dropped `{{paths}}` would silently swallow the one piece of
          // information that makes the message actionable — and the key-based i18n gate
          // would still report the catalogue as 100 % complete.
          if (!has.has(name)) missing.push(`${language}: ${key} lost {{${name}}}`)
        }
      }
    }

    expect(missing).toEqual([])
  })
})
