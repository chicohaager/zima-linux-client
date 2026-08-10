// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { appError, NO_PATH_ANSWERED } from '@shared/result'
import { useResume } from '../useResume'

/**
 * Nothing reaches out to a stored device until someone asks.
 *
 * 🔴 The requirement, given twice by the maintainer on 2026-08-10: stored connections must
 * not be re-established by themselves, and a tunnel must come up **on request**. The first
 * attempt at this only made the automatic restore *smarter* — it measured the stored paths
 * instead of guessing one — and left the automatic part in place. Measuring the wrong thing
 * well is still the wrong thing, and the report came back a second time.
 *
 * The first test is therefore the one that carries the requirement, and it is a NEGATIVE
 * one: mount the hook, let every microtask and timer run, and assert that the IPC channel
 * was never touched. A test that only checks "start() restores the session" would have been
 * green before the change as well.
 */

const resumeSession = vi.fn()
const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

const install = (): void => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
    resumeSession,
    // Present so an accidental call is a *recorded* call and not a TypeError that could be
    // mistaken for the test's own breakage.
    currentSession: vi.fn(async () => ({ ok: false, error: appError('unauthorized', 'x', 'error.signInRequired') })),
    listDevices: vi.fn(async () => ({ ok: true, value: { devices: [], activeDeviceId: null } })),
  }
}

afterEach(() => {
  cleanup()
  resumeSession.mockReset()
})

describe('useResume', () => {
  it('touches nothing on mount — no session, no device list, no tunnel', async () => {
    install()
    const { result } = renderHook(() => useResume(), { wrapper })

    // Two turns of the event loop: enough for any effect-launched promise chain to have
    // reached its first await and called out.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const zima = (globalThis as unknown as { window: { zima: Record<string, ReturnType<typeof vi.fn>> } })
      .window.zima
    expect(resumeSession).not.toHaveBeenCalled()
    expect(zima['currentSession']).not.toHaveBeenCalled()
    expect(zima['listDevices']).not.toHaveBeenCalled()
    expect(result.current.state.phase).toBe('idle')
    // The marker a scripted verification reads must agree with that, or the scenario waits
    // for an event that is never coming.
    expect(document.body.dataset['resumePhase']).toBe('idle')
  })

  it('restores the session when asked, and only then', async () => {
    install()
    resumeSession.mockResolvedValue({ ok: true, value: { deviceId: 'name:ZimaOS' } })
    const { result } = renderHook(() => useResume(), { wrapper })

    let outcome
    await act(async () => {
      outcome = await result.current.start('name:ZimaOS')
    })

    expect(resumeSession).toHaveBeenCalledWith({ deviceId: 'name:ZimaOS' })
    expect(outcome).toEqual({ phase: 'done' })
    await waitFor(() => expect(result.current.state.phase).toBe('done'))
  })

  it('reports a missing secret as "nothing-stored", not as a fault', async () => {
    install()
    resumeSession.mockResolvedValue({
      ok: false,
      error: appError('unauthorized', 'no stored session', 'error.signInRequired'),
    })
    const { result } = renderHook(() => useResume(), { wrapper })

    let outcome
    await act(async () => {
      outcome = await result.current.start('name:ZimaOS')
    })

    expect(outcome).toEqual({ phase: 'nothing-stored' })
  })

  it('carries the device id into a real failure, so a path can be offered for it', async () => {
    install()
    const dead = appError('timeout', 'no stored path answered', NO_PATH_ANSWERED, {
      paths: '192.0.2.7=timeout',
    })
    resumeSession.mockResolvedValue({ ok: false, error: dead })
    const { result } = renderHook(() => useResume(), { wrapper })

    let outcome
    await act(async () => {
      outcome = await result.current.start('name:ZimaOS')
    })

    expect(outcome).toEqual({ phase: 'failed', error: dead, deviceId: 'name:ZimaOS' })
  })

  it('does not run twice at once — a resume rotates the token it just stored', async () => {
    install()
    let release: (value: unknown) => void = () => {}
    resumeSession.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          release = resolve
        }),
    )
    const { result } = renderHook(() => useResume(), { wrapper })

    await act(async () => {
      void result.current.start('name:ZimaOS')
      void result.current.start('name:ZimaOS')
      release({ ok: true, value: { deviceId: 'name:ZimaOS' } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(resumeSession).toHaveBeenCalledTimes(1)
  })
})
