// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BackupPanel } from '../BackupPanel'

/**
 * Progress while a backup runs.
 *
 * 🔴 Found by the video fact check on 2026-10-08, still open in 2.0.5 (re-measured 2026-10-17):
 * six seconds into a run the panel showed no status, no progress and no Cancel button.
 * `startPhotoBackup` resolves only when the whole run is over, and the status query polled only
 * once it already knew `scanning`/`uploading` — before the run it knew `idle`, so nothing ever
 * asked. The main process sets `scanning` at once; the panel has to ask while the start runs.
 */

const t = (key: string, values?: Record<string, unknown>): string =>
  values === undefined ? key : `${key} ${JSON.stringify(values)}`

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en-US' } }),
}))

const IDLE = {
  phase: 'idle',
  targetPath: '',
  total: 0,
  uploaded: 0,
  skipped: 0,
  failed: 0,
  bytesSent: 0,
  bytesTotal: 0,
  currentFile: null,
  startedAtMs: null,
  finishedAtMs: null,
  notes: [],
}

afterEach(cleanup)

describe('BackupPanel', () => {
  it('shows progress and Cancel while the start call has not returned yet', async () => {
    let started = false
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
      pickBackupFolders: async () => ({ ok: true, value: { folders: ['/tmp/photos/Phone'] } }),
      // Never resolves within the test: the run is still going.
      startPhotoBackup: () => {
        started = true
        return new Promise(() => {})
      },
      photoBackupStatus: async () => ({
        ok: true,
        value: started
          ? { ...IDLE, phase: 'uploading', total: 10, uploaded: 3, bytesSent: 300, bytesTotal: 1000, targetPath: '/DATA' }
          : IDLE,
      }),
      cancelPhotoBackup: async () => ({ ok: true, value: IDLE }),
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BackupPanel destination="/DATA" />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByText('backup.pickFolders'))
    await waitFor(() => expect(screen.getByText(/^backup\.start/).closest('button')?.disabled).toBe(false))
    fireEvent.click(screen.getByText(/^backup\.start/))

    await waitFor(() => expect(screen.getByText('backup.phase.uploading')).toBeTruthy(), { timeout: 3000 })
    expect(screen.getByText(/^backup\.counts .*"uploaded":3/)).toBeTruthy()
    expect(screen.getByText('backup.cancel')).toBeTruthy()
  })
})
