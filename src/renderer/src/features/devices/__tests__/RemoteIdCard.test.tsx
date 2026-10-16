// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { appError } from '@shared/result'
import { RemoteIdCard } from '../RemoteIdCard'
import type { SignInTarget } from '../signInTarget'

/**
 * The Remote ID card, rendered with the real catalogue and a stand-in for `window.zima`.
 *
 * Written when the card moved out of DeviceScreen.tsx (2026-10-16): nothing rendered this
 * branch before, so the move could only be checked by reading it. The stand-in replaces the
 * IPC bridge and nothing else — whether the join itself works is the `remote-id` scenario's
 * job, against a real device.
 */

const catalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'src/renderer/src/i18n/locales/en_US.json'), 'utf8'),
) as Record<string, unknown>

const i18n = i18next.createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: catalogue } },
  interpolation: { escapeValue: false },
})

type Bridge = {
  connectRemoteId: ReturnType<typeof vi.fn>
  zerotierProvision: ReturnType<typeof vi.fn>
}

const mount = (bridge: Bridge): { onConnected: ReturnType<typeof vi.fn> } => {
  Object.defineProperty(window, 'zima', { value: bridge, configurable: true })
  const onConnected = vi.fn<(target: SignInTarget) => void>()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <I18nextProvider i18n={i18n}>
        <RemoteIdCard onConnected={onConnected} />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return { onConnected }
}

const input = (name: string): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>(`input[name="${name}"]`)
  if (el === null) throw new Error(`no input named ${name}`)
  return el
}

const submit = (): HTMLButtonElement =>
  screen.getByRole('button', { name: i18n.t('device.connect') })

afterEach(() => cleanup())

describe('RemoteIdCard', () => {
  it('only offers to connect for a 16-hex ID and a port from 1 to 65535', () => {
    mount({ connectRemoteId: vi.fn(), zerotierProvision: vi.fn() })

    expect(submit().disabled).toBe(true)
    fireEvent.change(input('remoteId'), { target: { value: '0123456789abcde' } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(input('remoteId'), { target: { value: '0123456789ABCDEF' } })
    expect(submit().disabled).toBe(false)
    fireEvent.change(input('remotePort'), { target: { value: '70000' } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(input('remotePort'), { target: { value: '' } })
    expect(submit().disabled).toBe(true)
    fireEvent.change(input('remotePort'), { target: { value: '8443' } })
    expect(submit().disabled).toBe(false)
  })

  it('hands the parent a remote-id target that keeps the network ID, lower-cased', async () => {
    const connectRemoteId = vi.fn().mockResolvedValue({
      ok: true,
      value: { host: '192.0.2.10', port: 8443, networkName: 'home' },
    })
    const { onConnected } = mount({ connectRemoteId, zerotierProvision: vi.fn() })

    fireEvent.change(input('remoteId'), { target: { value: ' 0123456789ABCDEF ' } })
    fireEvent.change(input('remotePort'), { target: { value: '8443' } })
    fireEvent.click(submit())

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    expect(connectRemoteId).toHaveBeenCalledWith({ remoteId: '0123456789ABCDEF', port: 8443 })
    expect(onConnected).toHaveBeenCalledWith({
      host: '192.0.2.10',
      port: 8443,
      kind: 'remote-id',
      networkId: '0123456789abcdef',
      displayName: 'home',
    })
  })

  it('leaves displayName absent, not undefined, when the network has no name', async () => {
    const connectRemoteId = vi.fn().mockResolvedValue({
      ok: true,
      value: { host: '192.0.2.10', port: 80, networkName: '' },
    })
    const { onConnected } = mount({ connectRemoteId, zerotierProvision: vi.fn() })

    fireEvent.change(input('remoteId'), { target: { value: '0123456789abcdef' } })
    fireEvent.click(submit())

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1))
    const target = onConnected.mock.calls[0]?.[0] as SignInTarget
    expect('displayName' in target).toBe(false)
  })

  it('offers the provisioning step for the missing network device, and only for that', async () => {
    const missing = appError(
      'capability-missing',
      'the local ZeroTier daemon cannot create a virtual network device',
      'error.zerotierMissing',
    )
    const connectRemoteId = vi.fn().mockResolvedValue({ ok: false, error: missing })
    mount({ connectRemoteId, zerotierProvision: vi.fn() })

    fireEvent.change(input('remoteId'), { target: { value: '0123456789abcdef' } })
    fireEvent.click(submit())

    expect(
      await screen.findByRole('button', { name: i18n.t('zerotier.provision') }),
    ).toBeTruthy()
  })

  it('does not offer provisioning for an unrelated failure', async () => {
    // Same words, different kind: the kind is what decides, so the message alone must not.
    const other = appError(
      'timeout',
      'the local ZeroTier daemon cannot create a virtual network device',
      'error.timeout',
    )
    const connectRemoteId = vi.fn().mockResolvedValue({ ok: false, error: other })
    mount({ connectRemoteId, zerotierProvision: vi.fn() })

    fireEvent.change(input('remoteId'), { target: { value: '0123456789abcdef' } })
    fireEvent.click(submit())

    await waitFor(() => expect(connectRemoteId).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(submit().disabled).toBe(false))
    expect(screen.queryByRole('button', { name: i18n.t('zerotier.provision') })).toBeNull()
  })
})
