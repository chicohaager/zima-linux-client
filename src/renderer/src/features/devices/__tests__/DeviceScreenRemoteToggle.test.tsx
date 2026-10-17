// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { appError } from '@shared/result'

/**
 * Closing and reopening the Remote ID card keeps what was typed into it.
 *
 * Decided 2026-10-16: the split into RemoteIdCard.tsx made collapsing the card empty both
 * fields, because the state moved into a component that unmounted on close. Before the split
 * the state lived in DeviceScreen and survived the toggle; that is the behaviour wanted.
 *
 * Everything around the card is stubbed out: this test is about the toggle and nothing else.
 */

vi.mock('../../session/SessionCard', () => ({ SessionCard: () => null }))
vi.mock('../../session/useResume', () => ({
  useResume: () => ({ state: { phase: 'idle' }, start: vi.fn() }),
}))
vi.mock('../DeviceList', () => ({ DeviceList: () => null }))
// Stand-in with a cancel button: the property under test is DeviceScreen's state across the
// switch to the sign-in form and back, not the form itself.
vi.mock('../../session/SignInForm', () => ({
  SignInForm: ({ onCancel }: { onCancel?: () => void }) => (
    <button type="button" data-testid="cancel-sign-in" onClick={onCancel}>
      cancel
    </button>
  ),
}))
vi.mock('../../settings/TailscalePanel', () => ({ TailscalePanel: () => null }))
vi.mock('../../settings/LegacyImportPanel', () => ({ LegacyImportPanel: () => null }))
vi.mock('../../settings/LogFolderButton', () => ({ LogFolderButton: () => null }))

const { DeviceScreen } = await import('../DeviceScreen')

const catalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'src/renderer/src/i18n/locales/en_US.json'), 'utf8'),
) as Record<string, unknown>

const i18n = i18next.createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
})

const mount = (): void => {
  Object.defineProperty(window, 'zima', {
    value: {
      currentSession: vi.fn().mockResolvedValue({
        ok: false,
        error: appError('unauthorized', 'no session', 'error.unauthorized'),
      }),
      connectRemoteId: vi.fn(),
      zerotierProvision: vi.fn(),
    },
    configurable: true,
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nextProvider i18n={i18n}>
        <DeviceScreen />
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const toggle = (): void => {
  const button = document.querySelector<HTMLButtonElement>('[data-action="remote-id"]')
  if (button === null) throw new Error('no remote-id button')
  fireEvent.click(button)
}

const field = (name: string): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (el === null) throw new Error(`no input named ${name}`)
  return el
}

/** Visible in the sense the user sees it: no ancestor carries `hidden`. */
const shown = (el: Element): boolean => el.closest('[hidden]') === null

afterEach(() => cleanup())

describe('DeviceScreen Remote ID toggle', () => {
  it('starts closed and opens on the button', () => {
    mount()
    const before = document.querySelector('input[name="remoteId"]')
    expect(before === null || !shown(before)).toBe(true)
    toggle()
    expect(shown(field('remoteId'))).toBe(true)
  })

  it('keeps ID and port when the card is closed and opened again', () => {
    mount()
    toggle()
    fireEvent.change(field('remoteId'), { target: { value: '0123456789abcdef' } })
    fireEvent.change(field('remotePort'), { target: { value: '8443' } })

    toggle()
    const closed = document.querySelector('input[name="remoteId"]')
    expect(closed === null || !shown(closed)).toBe(true)

    toggle()
    expect(field('remoteId').value).toBe('0123456789abcdef')
    expect(field('remotePort').value).toBe('8443')
  })

  /*
   * 🔴 Found while re-shooting the YouTube video on 2.0.4 (2026-10-17): typed a Remote ID, took
   * the IP-address path instead, and the ID was gone afterwards. DeviceScreen renders ONLY the
   * sign-in form while a target is set, so the card unmounted with its state — `hidden` covered
   * the toggle, not this detour. In 2.0.3 the state lived in DeviceScreen and survived it.
   */
  it('keeps ID and port across a detour through the IP sign-in form', () => {
    mount()
    toggle()
    fireEvent.change(field('remoteId'), { target: { value: '0123456789abcdef' } })
    fireEvent.change(field('remotePort'), { target: { value: '8443' } })

    const direct = document.querySelector<HTMLButtonElement>('[data-action="direct-ip"]')
    if (direct === null) throw new Error('no direct-ip button')
    fireEvent.click(direct)
    const cancel = document.querySelector<HTMLButtonElement>('[data-testid="cancel-sign-in"]')
    if (cancel === null) throw new Error('the sign-in form did not open')
    fireEvent.click(cancel)

    expect(field('remoteId').value).toBe('0123456789abcdef')
    expect(field('remotePort').value).toBe('8443')
  })
})
