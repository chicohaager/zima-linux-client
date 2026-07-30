import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Locale } from '@shared/domain'
import { LOCALES, localeInfo } from '../../i18n/locales'
import { changeLocale } from '../../i18n'

/**
 * Language picker for all 28 locales.
 *
 * Languages are listed by their endonym, and an unreviewed translation is marked as such
 * next to it. Hiding that would present machine output as finished work.
 */
export const LanguageMenu = (): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = localeInfo(i18n.language)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('settings.language')}
        className="flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium"
        style={{
          background: 'var(--surface-card)',
          color: 'var(--text-muted)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <span aria-hidden>🌐</span>
        {current?.nativeName ?? i18n.language}
      </button>

      {open && (
        <ul
          className="absolute right-0 bottom-full z-20 mb-2 max-h-80 w-60 overflow-y-auto rounded-2xl p-1.5"
          style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-float)' }}
        >
          {LOCALES.map((locale) => {
            const active = locale.code === i18n.language
            return (
              <li key={locale.code}>
                <button
                  type="button"
                  onClick={() => {
                    void changeLocale(locale.code as Locale)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm"
                  style={{
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-strong)',
                  }}
                >
                  <span className="flex-1">{locale.nativeName}</span>
                  {!locale.reviewed && (
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('settings.unreviewed')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
