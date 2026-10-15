// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FilesScreen } from '../FilesScreen'

/**
 * 🔴 The File Hub fetched page one (500 entries) and stopped; a folder of 1 200 showed 500,
 * with nothing to reach the rest. `total` here is the directory size (the API's `all`).
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}))

const entry = (n: number): Record<string, unknown> => ({
  name: `file${n}.txt`,
  path: `/DATA/file${n}.txt`,
  isDir: false,
  size: 1,
  modifiedMs: 0,
})

afterEach(cleanup)

describe('FilesScreen paging', () => {
  it('asks for index 2 on "load more", appends, and hides the button at the end', async () => {
    const indices: number[] = []
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.zima = {
      storageVolumes: async () => ({ ok: true, value: [{ path: '/DATA' }] }),
      listFiles: async (input: { index: number }) => {
        indices.push(input.index)
        return input.index === 1
          ? { ok: true, value: { path: '/DATA', entries: [entry(1)], total: 501, index: 1, size: 500 } }
          : { ok: true, value: { path: '/DATA', entries: [entry(2)], total: 501, index: 2, size: 500 } }
      },
      listPins: async () => ({ ok: true, value: [] }),
      fileTasks: async () => ({ ok: true, value: [] }),
      listTrash: async () => ({ ok: true, value: [] }),
    }
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FilesScreen />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('file1.txt')).toBeTruthy())
    fireEvent.click(screen.getByText('files.loadMore'))
    await waitFor(() => expect(screen.getByText('file2.txt')).toBeTruthy())
    expect(screen.getByText('file1.txt')).toBeTruthy()
    expect(indices).toEqual([1, 2])
    expect(screen.queryByText('files.loadMore')).toBeNull()
  })
})
