import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AppError } from '@shared/result'

/**
 * Turns a stored refresh token back into a session — **when the user asks for it**.
 *
 * 🔴 This used to run by itself on every start, and that was wrong. Reported twice by the
 * maintainer on 2026-08-10: stored connections must not be re-established on their own, and
 * a tunnel must come up on request, never by itself. The first round only made the automatic
 * attempt *smarter* — it measured the paths instead of guessing one — and left the automatic
 * part standing. Measuring the wrong thing well is still the wrong thing.
 *
 * Why it matters beyond taste: an unasked-for restore reaches out over whichever tunnel was
 * stored. Opening a ZeroTier road costs a join that can take over the machine's DNS, and a
 * Tailscale address is used whether or not the user wanted that link up right now. A client
 * that phones home at start decides for the user which network they are on.
 *
 * So: nothing happens until `start(deviceId)` is called from a button. Two states are still
 * told apart, because collapsing them would hide a real failure behind a normal one:
 *
 *  - `error.signInRequired` — no secret stored for this device. Expected on a fresh install;
 *    the caller opens the sign-in form instead of showing a fault.
 *  - anything else — the token existed and the attempt failed (expired refresh token, device
 *    unreachable, keyring unreadable). Shown with the technical context, because a silent
 *    failure here reads as "logged out for no reason".
 */

export type ResumeState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'running' }
  | { readonly phase: 'done' }
  /** No stored secret — the caller should offer the sign-in form. */
  | { readonly phase: 'nothing-stored' }
  /**
   * `deviceId` travels with the failure because the screen needs it: the one useful thing
   * to offer here is "let me look for another way to reach THIS device", and without the
   * id the offer would have to guess which device the failure was about.
   */
  | { readonly phase: 'failed'; readonly error: AppError; readonly deviceId: string | null }

export interface Resume {
  readonly state: ResumeState
  /**
   * Restores the session for one device. Returns the resulting state so the caller can act
   * on it directly — without waiting for a re-render to observe it.
   */
  readonly start: (deviceId: string) => Promise<ResumeState>
}

export const useResume = (): Resume => {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ResumeState>({ phase: 'idle' })
  // A resume rotates the refresh token on the device, so two overlapping runs would
  // invalidate the token the first one just stored. A double click must not do that.
  const running = useRef(false)

  const start = useCallback(
    async (deviceId: string): Promise<ResumeState> => {
      if (running.current) return state
      running.current = true
      setState({ phase: 'running' })
      try {
        const resumed = await window.zima.resumeSession({ deviceId })
        if (resumed.ok) {
          await queryClient.invalidateQueries({ queryKey: ['session'] })
          await queryClient.invalidateQueries({ queryKey: ['devices'] })
          const next: ResumeState = { phase: 'done' }
          setState(next)
          return next
        }
        const next: ResumeState =
          resumed.error.i18nKey === 'error.signInRequired'
            ? { phase: 'nothing-stored' }
            : { phase: 'failed', error: resumed.error, deviceId }
        setState(next)
        return next
      } finally {
        running.current = false
      }
    },
    [queryClient, state],
  )

  /*
   * Publishes the phase where a scripted verification can see it.
   *
   * `idle` is now a terminal state — it means "the user has not asked yet", which is the
   * normal condition at start. `scenarioKit`'s waiter counts it as settled for exactly that
   * reason; treating it as "still working" would make every scenario wait out its whole
   * budget for something that is never coming.
   *
   * Written from the hook rather than rendered as an element, because it must agree with
   * `state` by construction — a marker in one of DeviceScreen's two return branches would go
   * missing the day someone adds a third.
   */
  useEffect(() => {
    document.body.dataset['resumePhase'] = state.phase
  }, [state.phase])

  return { state, start }
}
