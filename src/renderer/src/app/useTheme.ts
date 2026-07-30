import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'zima.theme'

const isChoice = (value: string | null): value is ThemeChoice =>
  value === 'system' || value === 'light' || value === 'dark'

/**
 * Theme handling. `system` follows prefers-color-scheme; an explicit choice stamps
 * data-theme on the root element, and the CSS gives that attribute the last word in
 * both directions — a one-sided override would make the toggle work only into dark.
 */
export interface Theme {
  readonly choice: ThemeChoice
  readonly resolved: 'light' | 'dark'
  readonly setChoice: (choice: ThemeChoice) => void
}

export const useTheme = (): Theme => {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isChoice(stored) ? stored : 'system'
  })
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  const resolved: 'light' | 'dark' =
    choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', choice)
    }
  }, [choice])

  const setChoice = useCallback((next: ThemeChoice): void => {
    localStorage.setItem(STORAGE_KEY, next)
    setChoiceState(next)
  }, [])

  return { choice, resolved, setChoice }
}
