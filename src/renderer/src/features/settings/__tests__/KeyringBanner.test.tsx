// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SecretStoreStatus } from '@shared/domain'
import { KeyringBanner } from '../KeyringBanner'

/**
 * The panel must step aside once the question it asks has been answered.
 *
 * 🔴 Measured 2026-09-17 on the README screenshots: `scripts/screenshots.mjs` clicks
 * "Ask every time" before the first picture, and every one of the seven pictures still
 * carried the red panel. Not a flaw of the script — the panel rendered on `plaintextRisk`
 * alone, which no answer changes, so on a machine without a keyring both buttons did
 * nothing anyone could see. For good.
 *
 * Each button gets its own case, because they are remembered on different sides:
 * "store anyway" is a file the main process reports back as `plaintextConsent`, and
 * "ask every time" is this window's memory only. And the positive case is kept — a panel
 * that never appears would pass both negative cases as well.
 */

const risk = (overrides: Partial<SecretStoreStatus> = {}): SecretStoreStatus => ({
  backend: 'basic_text',
  encryptionAvailable: true,
  plaintextRisk: true,
  plaintextConsent: false,
  ...overrides,
})

const secretStoreStatus = vi.fn()
const setPlaintextConsent = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const install = (): void => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
    secretStoreStatus,
    setPlaintextConsent,
  }
}

const mount = (): QueryClient => {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <KeyringBanner />
    </QueryClientProvider>,
  )
  return client
}

/**
 * Waits until the status query has actually produced data. "The mock was called" is not
 * that: under a sabotaged component this file's negative case stayed green, because the
 * assertion ran between the call and the render — measured 2026-09-17.
 */
const settled = async (client: QueryClient): Promise<void> => {
  await waitFor(() =>
    expect(client.getQueryState(['secrets', 'status'])?.status).toBe('success'),
  )
}

afterEach(() => {
  cleanup()
  secretStoreStatus.mockReset()
  setPlaintextConsent.mockReset()
})

describe('KeyringBanner', () => {
  it('appears while the risk is real and unanswered', async () => {
    install()
    secretStoreStatus.mockResolvedValue({ ok: true, value: risk() })
    mount()
    expect(await screen.findByText('security.keyringTitle')).toBeTruthy()
  })

  it('stays away when the status says the risk was accepted earlier', async () => {
    install()
    secretStoreStatus.mockResolvedValue({ ok: true, value: risk({ plaintextConsent: true }) })
    await settled(mount())
    expect(screen.queryByText('security.keyringTitle')).toBeNull()
  })

  it('leaves after "store anyway", because the main process now reports consent', async () => {
    install()
    secretStoreStatus.mockResolvedValueOnce({ ok: true, value: risk() })
    // The answer is a file on the main side; the refetch after the mutation is what carries it.
    setPlaintextConsent.mockImplementation(async () => {
      secretStoreStatus.mockResolvedValue({ ok: true, value: risk({ plaintextConsent: true }) })
      return { ok: true, value: risk({ plaintextConsent: true }) }
    })
    mount()
    fireEvent.click(await screen.findByText('security.storeAnyway'))
    await waitFor(() => expect(screen.queryByText('security.keyringTitle')).toBeNull())
    expect(setPlaintextConsent).toHaveBeenCalledWith({ granted: true })
  })

  it('leaves after "ask every time" for this window, while the status still says risk', async () => {
    install()
    // Deliberately the same status before and after: "ask every time" changes nothing on
    // the main side, so a banner that only reads the status would come straight back.
    secretStoreStatus.mockResolvedValue({ ok: true, value: risk() })
    setPlaintextConsent.mockResolvedValue({ ok: true, value: risk() })
    mount()
    fireEvent.click(await screen.findByText('security.askEveryTime'))
    await waitFor(() => expect(screen.queryByText('security.keyringTitle')).toBeNull())
    expect(setPlaintextConsent).toHaveBeenCalledWith({ granted: false })
  })
})
