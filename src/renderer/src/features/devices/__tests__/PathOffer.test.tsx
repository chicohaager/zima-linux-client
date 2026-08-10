// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { appError, NO_PATH_ANSWERED } from '@shared/result'
import { PathOffer, offersPaths } from '../PathOffer'

/**
 * The card is allowed to appear only for the failure its own sentence describes.
 *
 * 🔴 Written after a measured wrong claim in the shipped UI, 2026-08-10. A tester's log,
 * addresses replaced by documentation ones:
 *
 *     session.resume-path-chosen {"host":"192.0.2.1","attempts":["192.0.2.1=19ms"]}
 *     zima.request {"path":"/v1/users/refresh","status":401,"ms":8,"bytes":93}
 *
 * The stored path answered in eight milliseconds; only the refresh token had expired. The
 * card underneath nevertheless read "Das Gerät hat auf keinem gespeicherten Weg
 * geantwortet" and offered to add a path he did not need — because it was rendered for
 * every failed resume, without ever looking at why the resume failed.
 *
 * Both directions are asserted on purpose. A test that only checks "the card appears for a
 * dead path" would have been green before the fix as well: the defect was not a missing
 * card, it was a card that never stayed away. The negative case is therefore the one that
 * carries the guarantee, and it asserts two things — nothing rendered AND no scan started,
 * because a silent LAN scan for a failure it cannot help with is the same bug one layer
 * down.
 */

const DEVICE_ID = 'name:IceWhale-RemoteAccess'

const withClient = (ui: React.ReactElement): React.ReactElement => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
)

const findDevicePaths = vi.fn()

vi.mock('react-i18next', () => ({
  // Keys, not translations: this test is about which card is shown, and a key is a stable
  // identity across all 28 catalogues.
  useTranslation: () => ({ t: (key: string) => key }),
}))

const install = (): void => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
    findDevicePaths,
    addDevicePath: vi.fn(),
  }
}

afterEach(() => {
  cleanup()
  findDevicePaths.mockReset()
})

describe('offersPaths', () => {
  it('is true only for the failure that means no stored path answered', () => {
    expect(offersPaths(appError('timeout', 'none answered', NO_PATH_ANSWERED))).toBe(true)
  })

  it.each([
    ['unauthorized', 'error.unauthorized'],
    ['unauthorized', 'error.sessionExpired'],
    ['unauthorized', 'error.signInRequired'],
    ['timeout', 'error.timeout'],
    ['internal', 'error.internal'],
  ] as const)('is false for %s / %s', (kind, key) => {
    expect(offersPaths(appError(kind, 'measured elsewhere', key))).toBe(false)
  })
})

describe('PathOffer', () => {
  it('stays silent and starts no scan when the session merely expired', async () => {
    install()
    const expired = appError('unauthorized', 'refresh rejected', 'error.unauthorized', {
      host: '192.0.2.10',
      status: 401,
    })

    const { container } = render(withClient(<PathOffer deviceId={DEVICE_ID} resumeError={expired} />))

    // Give any effect that might still fire a turn of the event loop to do so.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.innerHTML).toBe('')
    expect(findDevicePaths).not.toHaveBeenCalled()
  })

  it('offers the found address when no stored path answered', async () => {
    install()
    findDevicePaths.mockResolvedValue({
      ok: true,
      value: {
        candidates: [{ host: '192.0.2.10', port: 80, deviceName: 'ZimaOS' }],
        learned: [],
      },
    })
    const dead = appError('timeout', 'no stored path answered', NO_PATH_ANSWERED, {
      paths: '198.51.100.7=timeout',
    })

    render(withClient(<PathOffer deviceId={DEVICE_ID} resumeError={dead} />))

    expect(await screen.findByText('device.pathOffer.title')).toBeDefined()
    expect(screen.getByText('192.0.2.10:80')).toBeDefined()
    expect(findDevicePaths).toHaveBeenCalledWith({ deviceId: DEVICE_ID })
  })
})
