import { useTranslation } from 'react-i18next'
import type { Theme, ThemeChoice } from '../../app/useTheme'

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark']

const LABEL_KEY: Record<ThemeChoice, string> = {
  system: 'common.themeSystem',
  light: 'common.themeLight',
  dark: 'common.themeDark',
}

const GLYPH: Record<ThemeChoice, string> = { system: '◐', light: '☀', dark: '☾' }

/**
 * Three explicit choices instead of a two-state toggle.
 *
 * "Follow the system" is a distinct wish from "always light", and a toggle cannot express
 * it: once tapped, the user can never get back to following the system.
 */
export const ThemeMenu = ({ theme }: { readonly theme: Theme }): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <div
      role="radiogroup"
      aria-label={t('common.theme')}
      className="flex items-center gap-0.5 rounded-full p-1"
      style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-card)' }}
    >
      {CHOICES.map((choice) => {
        const active = theme.choice === choice
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={active}
            title={t(LABEL_KEY[choice])}
            onClick={() => theme.setChoice(choice)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm"
            style={{
              background: active ? 'var(--accent-soft)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <span aria-hidden>{GLYPH[choice]}</span>
            <span className="sr-only">{t(LABEL_KEY[choice])}</span>
          </button>
        )
      })}
    </div>
  )
}
