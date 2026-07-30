import { useTranslation } from 'react-i18next'
import { PILL_SECTIONS, SECTIONS, type Section } from './sections'
import { FolderIcon, GridIcon, PhotoIcon } from '../shared/ui/Icons'

/**
 * The four destinations, in two layouts.
 *
 * Narrow: the floating pill of the mobile client — three icons plus the separated round
 * device button. Wide: a sidebar listing the same four entries with labels. Same
 * information architecture either way; only the ergonomics change.
 */

const ICONS: Record<(typeof PILL_SECTIONS)[number], () => React.JSX.Element> = {
  files: FolderIcon,
  photos: PhotoIcon,
  apps: GridIcon,
}

interface Props {
  readonly section: Section
  readonly onSectionChange: (section: Section) => void
}

export const BottomPillNavigation = ({ section, onSectionChange }: Props): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <div className="pointer-events-auto flex items-center gap-3">
      <div
        className="flex items-center gap-1 rounded-[999px] p-1.5"
        style={{ background: 'var(--surface-card)', boxShadow: 'var(--shadow-float)' }}
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

      {/* Set apart from the pill, exactly as in the mobile client. */}
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
    </div>
  )
}

const SIDEBAR_ICONS: Record<Section, () => React.JSX.Element> = {
  files: FolderIcon,
  photos: PhotoIcon,
  apps: GridIcon,
  device: () => (
    <span aria-hidden className="text-base font-semibold">
      Z
    </span>
  ),
}

export const SidebarNavigation = ({ section, onSectionChange }: Props): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('nav.device')}
      className="flex w-56 shrink-0 flex-col gap-1 p-4"
      style={{ borderRight: '1px solid var(--border-subtle)' }}
    >
      <span
        className="mb-3 px-2 text-xs font-semibold tracking-widest uppercase"
        style={{ color: 'var(--text-muted)' }}
      >
        ZimaOS
      </span>
      {SECTIONS.map((key) => {
        const Icon = SIDEBAR_ICONS[key]
        const active = section === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSectionChange(key)}
            aria-current={active ? 'page' : undefined}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors"
            style={{
              background: active ? 'var(--accent-soft)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            <Icon />
            {t(`nav.${key}`)}
          </button>
        )
      })}
    </nav>
  )
}
