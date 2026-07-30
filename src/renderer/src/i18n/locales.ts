import type { Locale } from '@shared/domain'

/**
 * The 28 locales ZimaOS v1.7.0 ships in its own web interface — 27 language chunks under
 * /usr/share/casaos/www/assets/ plus en_US inline. Measured, not chosen.
 *
 * The mobile client advertises 29. Which language the extra one is has not been measured,
 * so it is not invented here; see § 14 of docs/V2-PLAN.md.
 *
 * `reviewed` is honest bookkeeping: true only where a translation has actually been
 * checked by someone who speaks the language. Everything else is marked as unreviewed and
 * the language menu says so, because a wrong translation presented as final is worse than
 * one that admits its state.
 */
export interface LocaleInfo {
  readonly code: Locale
  /** Endonym — a language menu that lists languages in English helps nobody. */
  readonly nativeName: string
  readonly reviewed: boolean
}

export const LOCALES: readonly LocaleInfo[] = [
  { code: 'ca_ES', nativeName: 'Català', reviewed: false },
  { code: 'cs_CZ', nativeName: 'Čeština', reviewed: false },
  { code: 'da_DK', nativeName: 'Dansk', reviewed: false },
  { code: 'de_DE', nativeName: 'Deutsch', reviewed: true },
  { code: 'el_GR', nativeName: 'Ελληνικά', reviewed: false },
  { code: 'en_GB', nativeName: 'English (UK)', reviewed: true },
  { code: 'en_US', nativeName: 'English (US)', reviewed: true },
  { code: 'es_ES', nativeName: 'Español', reviewed: false },
  { code: 'fr_FR', nativeName: 'Français', reviewed: false },
  { code: 'ga_IE', nativeName: 'Gaeilge', reviewed: false },
  { code: 'hr_HR', nativeName: 'Hrvatski', reviewed: false },
  { code: 'hu_HU', nativeName: 'Magyar', reviewed: false },
  { code: 'it_IT', nativeName: 'Italiano', reviewed: false },
  { code: 'ja_JP', nativeName: '日本語', reviewed: false },
  { code: 'ko_KR', nativeName: '한국어', reviewed: false },
  { code: 'ml_IN', nativeName: 'മലയാളം', reviewed: false },
  { code: 'nb_NO', nativeName: 'Norsk bokmål', reviewed: false },
  { code: 'nl_NL', nativeName: 'Nederlands', reviewed: false },
  { code: 'pl_PL', nativeName: 'Polski', reviewed: false },
  { code: 'pt_BR', nativeName: 'Português (Brasil)', reviewed: false },
  { code: 'pt_PT', nativeName: 'Português', reviewed: false },
  { code: 'ro_RO', nativeName: 'Română', reviewed: false },
  { code: 'ru_RU', nativeName: 'Русский', reviewed: false },
  { code: 'sk_SK', nativeName: 'Slovenčina', reviewed: false },
  { code: 'sv_SE', nativeName: 'Svenska', reviewed: false },
  { code: 'tr_TR', nativeName: 'Türkçe', reviewed: false },
  { code: 'zh_CN', nativeName: '简体中文', reviewed: false },
  { code: 'zh_TW', nativeName: '繁體中文', reviewed: false },
]

export const localeInfo = (code: string): LocaleInfo | undefined =>
  LOCALES.find((l) => l.code === code)
