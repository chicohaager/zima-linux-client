import { useEffect, useState } from 'react'

/**
 * Current time as state, updated on an interval.
 *
 * Reading `Date.now()` during render is impure — React may re-render at any moment, so
 * the value would drift unpredictably (the react-hooks purity rule flags exactly this).
 * Keeping it in state also makes a countdown actually count down instead of freezing at
 * whatever the last render happened to see.
 */
export const useNow = (intervalMs = 30_000): number => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
