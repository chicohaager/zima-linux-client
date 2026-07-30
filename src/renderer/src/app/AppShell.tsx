import type { Section } from './sections'
import { BottomPillNavigation, SidebarNavigation } from './Navigation'
import { useIsWide } from './useViewportWidth'
import { ThemeMenu } from '../features/settings/ThemeMenu'
import { LanguageMenu } from '../features/settings/LanguageMenu'
import type { Theme } from './useTheme'

interface Props {
  readonly section: Section
  readonly onSectionChange: (section: Section) => void
  readonly theme: Theme
  readonly children: React.ReactNode
}

/**
 * Application frame.
 *
 * Two layouts, one information architecture: a narrow window keeps the mobile client's
 * floating pill, a wide one turns the same four destinations into a sidebar. Theme and
 * language controls sit in the top bar when there is room, and beside the pill when there
 * is not — they must be reachable in both, not only in the comfortable case.
 */
export const AppShell = ({
  section,
  onSectionChange,
  theme,
  children,
}: Props): React.JSX.Element => {
  const wide = useIsWide()

  if (wide) {
    return (
      <div className="flex h-full">
        <SidebarNavigation section={section} onSectionChange={onSectionChange} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="flex items-center justify-end gap-2 px-6 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <LanguageMenu />
            <ThemeMenu theme={theme} />
          </header>
          <main className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto w-full max-w-3xl">{children}</div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-y-auto px-5 pt-6 pb-28">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>

      <nav
        aria-label="ZimaOS"
        className="pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-5"
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <LanguageMenu />
          <ThemeMenu theme={theme} />
        </div>
        <BottomPillNavigation section={section} onSectionChange={onSectionChange} />
      </nav>
    </div>
  )
}
