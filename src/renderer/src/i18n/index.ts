import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type Locale } from '@shared/domain'
import de_DE from './locales/de_DE.json'
import en_US from './locales/en_US.json'

/**
 * 28 locales are planned — the exact set ZimaOS v1.7.0 ships in its own web UI
 * (27 language chunks plus en_US inline). The mobile client advertises 29; which
 * language the extra one is has not been measured, so it is not invented here.
 *
 * de_DE and en_US are maintained in this repository; the remaining 26 are added as
 * files. Everything falls back to en_US, and a missing key is a CI failure rather
 * than a raw key leaking into the interface.
 */

const bundled: Partial<Record<Locale, Record<string, unknown>>> = {
  de_DE,
  en_US,
}

/** Maps a system locale like "de-DE" or "de" onto a supported one. */
export const resolveLocale = (systemLocale: string): Locale => {
  const normalised = systemLocale.replace('-', '_')
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === normalised.toLowerCase())
  if (exact !== undefined) return exact

  const language = normalised.split('_')[0]?.toLowerCase()
  const byLanguage = SUPPORTED_LOCALES.find((l) => l.split('_')[0]?.toLowerCase() === language)
  return byLanguage ?? FALLBACK_LOCALE
}

void i18next.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(bundled).map(([locale, translation]) => [locale, { translation }]),
  ),
  lng: resolveLocale(navigator.language),
  fallbackLng: FALLBACK_LOCALE,
  interpolation: { escapeValue: false },
  // A missing key must be visible in development, never shipped as a raw key.
  saveMissing: false,
  returnEmptyString: false,
})

export { i18next }
