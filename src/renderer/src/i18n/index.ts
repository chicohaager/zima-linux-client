import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { FALLBACK_LOCALE, SUPPORTED_LOCALES, type Locale } from '@shared/domain'
import en_US from './locales/en_US.json'

/**
 * Translation loading.
 *
 * en_US is bundled eagerly because it is the fallback for every other language — without
 * it a missing key would render as the key itself. The other 27 are loaded on demand via
 * Vite's glob import, so switching a language costs one small chunk instead of shipping
 * all 28 in the initial bundle.
 *
 * Missing keys fall back to en_US rather than showing the raw key. A raw key on screen is
 * the classic i18n failure that green tests never catch, so the startup verifier looks for
 * exactly that pattern in the rendered DOM.
 */

const catalogues = import.meta.glob<{ default: Record<string, unknown> }>(
  './locales/*.json',
)

const pathFor = (locale: Locale): string => `./locales/${locale}.json`

/** Maps a system locale like "de-DE" or "de" onto a supported one. */
export const resolveLocale = (systemLocale: string): Locale => {
  const normalised = systemLocale.replace('-', '_')
  const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === normalised.toLowerCase())
  if (exact !== undefined) return exact

  const language = normalised.split('_')[0]?.toLowerCase()
  const byLanguage = SUPPORTED_LOCALES.find((l) => l.split('_')[0]?.toLowerCase() === language)
  return byLanguage ?? FALLBACK_LOCALE
}

/**
 * Loads a catalogue and registers it.
 *
 * A locale whose file is missing is a real problem, so it is reported instead of silently
 * leaving the user on English — that would look like "the translation is bad" rather than
 * "the file is not there".
 */
export const loadLocale = async (locale: Locale): Promise<boolean> => {
  if (i18next.hasResourceBundle(locale, 'translation')) return true

  const loader = catalogues[pathFor(locale)]
  if (loader === undefined) {
    console.error(`[i18n] no catalogue for ${locale}`)
    return false
  }

  const module = await loader()
  i18next.addResourceBundle(locale, 'translation', module.default, true, true)
  return true
}

export const changeLocale = async (locale: Locale): Promise<void> => {
  const loaded = await loadLocale(locale)
  if (!loaded) return
  await i18next.changeLanguage(locale)
  document.documentElement.lang = locale.replace('_', '-')
  localStorage.setItem('zima.locale', locale)
}

const storedLocale = (): Locale | null => {
  const stored = localStorage.getItem('zima.locale')
  return stored !== null && (SUPPORTED_LOCALES as readonly string[]).includes(stored)
    ? (stored as Locale)
    : null
}

const initial = storedLocale() ?? resolveLocale(navigator.language)

void i18next
  .use(initReactI18next)
  .init({
    resources: { en_US: { translation: en_US } },
    lng: FALLBACK_LOCALE,
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  })
  .then(() => changeLocale(initial))

export { i18next }
