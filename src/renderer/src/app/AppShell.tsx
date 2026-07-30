import { useTranslation } from 'react-i18next'
import { PILL_SECTIONS, type Section } from './sections'
import { FolderIcon, GridIcon, PhotoIcon } from '../shared/ui/Icons'
import type { Theme } from './useTheme'

/**
 * The shell reproduces the mobile client's navigation: a floating pill with three
 * icons and the device as a separate round button beside it. On a wide window the
 * same four destinations become a sidebar — identical information architecture,
 * desktop ergonomics.
 */

const ICONS: Record<(typeof PILL_SECTIONS)[number], () => React.JSX.Element> = {
  files: FolderIcon,
  photos: PhotoIcon,
  apps: GridIcon,
}

interface Props {
  readonly section: Section
  readonly onSectionChange: (section: Section) => void
  readonly theme: Theme
  readonly children: React.ReactNode
}

export const AppShell = ({
  section,
  onSectionChange,
  theme,
  children,
}: Props): React.JSX.Element => {
  const { t } = useTranslation()

  const cycleTheme = (): void => {
    const order = ['system', 'light', 'dark'] as const
    const next = order[(order.indexOf(theme.choice) + 1) % order.length] ?? 'system'
    theme.setChoice(next)
  }

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto px-5 pt-6 pb-28 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <nav
        aria-label={t('nav.files')}
        className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-5"
      >
        <div className="pointer-events-auto flex items-center gap-3">
          <div
            className="flex items-center gap-1 rounded-[999px] p-1.5"
            style={{
              background: 'var(--surface-card)',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            {PILL_SECTIONS.map((key) => {
              const Icon = ICONS[key]
              const active = section === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSectionChange(key)}
                  aria-current={active ? 'page' : undefined}
                  title={t(`nav.${key}`)}
                  className="flex h-11 w-14 items-center justify-center rounded-[999px] transition-colors"
                  style={{
                    background: active ? 'var(--surface-sunken)' : 'transparent',
                    color: active ? 'var(--text-strong)' : 'var(--text-muted)',
                  }}
                >
                  <Icon />
                  <span className="sr-only">{t(`nav.${key}`)}</span>
                </button>
              )
            })}
          </div>

          {/* The device button sits apart, exactly as in the mobile client. */}
          <button
            type="button"
            onClick={() => onSectionChange('device')}
            aria-current={section === 'device' ? 'page' : undefined}
            title={t('nav.device')}
            className="flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold transition-transform active:scale-95"
            style={{
              background: section === 'device' ? 'var(--accent)' : 'var(--surface-card)',
              color: section === 'device' ? 'var(--accent-contrast)' : 'var(--accent)',
              boxShadow: 'var(--shadow-float)',
            }}
          >
            Z<span className="sr-only">{t('nav.device')}</span>
          </button>

          <button
            type="button"
            onClick={cycleTheme}
            title={`${t('common.theme')}: ${t(`common.theme${theme.choice[0]?.toUpperCase()}${theme.choice.slice(1)}`)}`}
            className="flex h-11 w-11 items-center justify-center rounded-full text-xs font-medium"
            style={{
              background: 'var(--surface-card)',
              color: 'var(--text-muted)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            {theme.resolved === 'dark' ? '☾' : '☀'}
            <span className="sr-only">{t('common.theme')}</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
