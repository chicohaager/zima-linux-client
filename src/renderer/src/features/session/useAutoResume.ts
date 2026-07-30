import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AppError } from '@shared/result'

/**
 * Turns a stored refresh token back into a session at app start.
 *
 * This is the piece that was missing: the main process could resume (`session.resume`),
 * the bridge exposed it (`window.zima.resumeSession`), and nothing ever called it. The
 * refresh token was written to disk on every sign-in and then never read, so a restart
 * looked like "the device is remembered but you are logged out" — measured 2026-07-30 by
 * restarting the app and observing that `credentials.json` kept the *same* secret hash,
 * proving the token had not been used.
 *
 * Two states are deliberately told apart, because collapsing them would hide a real
 * failure behind a normal one:
 *
 *  - `error.signInRequired` — no secret stored for this device. That is the expected
 *    state of a fresh install, so it stays quiet.
 *  - anything else — the token existed and the attempt failed (expired refresh token,
 *    device unreachable, keyring unreadable). That is shown, with the technical context,
 *    because a silent failure here reads as "logged out for no reason".
 */

export type ResumeState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running' }
  | { readonly phase: 'done' }
  /** No stored secret — normal for a fresh install, rendered as nothing. */
  | { readonly phase: 'nothing-stored' }
  | { readonly phase: 'failed'; readonly error: AppError }

export const useAutoResume = (): ResumeState => {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ResumeState>({ phase: 'idle' })
  // Guards against React's development double-invoke and against a second run on
  // re-render: a resume rotates the refresh token on the device, so running it twice
  // would invalidate the token the first run just stored.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const run = async (): Promise<void> => {
      const existing = await window.zima.currentSession({})
      if (existing.ok) {
        setState({ phase: 'done' })
        return
      }

      const devices = await window.zima.listDevices({})
      if (!devices.ok) {
        setState({ phase: 'failed', error: devices.error })
        return
      }

      // The active device if one is marked, otherwise the only saved device. With several
      // devices and none active we do nothing rather than guess which one the user meant.
      const { devices: list, activeDeviceId } = devices.value
      const deviceId =
        activeDeviceId ?? (list.length === 1 && list[0] !== undefined ? list[0].id : null)
      if (deviceId === null) {
        setState({ phase: 'nothing-stored' })
        return
      }

      setState({ phase: 'running' })
      const resumed = await window.zima.resumeSession({ deviceId })
      if (resumed.ok) {
        await queryClient.invalidateQueries({ queryKey: ['session'] })
        await queryClient.invalidateQueries({ queryKey: ['devices'] })
        setState({ phase: 'done' })
        return
      }

      setState(
        resumed.error.i18nKey === 'error.signInRequired'
          ? { phase: 'nothing-stored' }
          : { phase: 'failed', error: resumed.error },
      )
    }

    void run()
  }, [queryClient])

  return state
}
