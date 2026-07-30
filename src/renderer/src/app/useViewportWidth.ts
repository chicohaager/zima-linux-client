import { useEffect, useState } from 'react'

/** Below this the layout keeps the mobile client's bottom pill; above it, a sidebar. */
export const SIDEBAR_BREAKPOINT_PX = 860

/**
 * Window width as state.
 *
 * Reading `window.innerWidth` during render is impure, and a CSS-only breakpoint would not
 * do here: the two layouts are different component trees (pill versus sidebar), not just
 * different styling of the same one.
 */
export const useViewportWidth = (): number => {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return width
}

export const useIsWide = (): boolean => useViewportWidth() >= SIDEBAR_BREAKPOINT_PX
