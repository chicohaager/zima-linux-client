import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card, Muted, Pill } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote } from '../../shared/ui/Controls'
import { CloudIcon, UploadIcon } from '../../shared/ui/Icons'
import { asAppError, errorDetail, unwrap } from '../../shared/lib/ipc'
import { formatBytes } from '../../shared/lib/format'

/**
 * Foreground photo backup.
 *
 * Three properties the UI has to communicate, not just implement:
 *
 *  - **It only runs while this window is open.** Stated on screen, because a user who
 *    expects a background sync would close the window and lose the transfer.
 *  - **Skipped files are listed with a reason.** A green "finished" over three quietly
 *    skipped photos is the failure that costs data — the notes list is the receipt.
 *  - **`done` means nothing failed.** Anything else is phase `failed`, even when most files
 *    went through, because a summary must never be greener than its own details.
 */
export const BackupPanel = ({
  destination,
}: {
  readonly destination: string
}): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const [sources, setSources] = useState<readonly string[]>([])

  const status = useQuery({
    queryKey: ['photos', 'backup-status'],
    queryFn: async () => unwrap(await window.zima.photoBackupStatus({})),
    // Polled only while something is happening. A permanent 1s poll would keep the main
    // process busy for a feature nobody is using.
    refetchInterval: (query) =>
      query.state.data?.phase === 'scanning' || query.state.data?.phase === 'uploading' ? 700 : false,
  })

  const pick = useMutation({
    mutationFn: async () => unwrap(await window.zima.pickBackupFolders({})),
    onSuccess: (result) => setSources(result.folders),
  })

  const start = useMutation({
    mutationFn: async () =>
      unwrap(await window.zima.startPhotoBackup({ sources: [...sources], destination })),
    onSuccess: () => void status.refetch(),
  })

  const cancel = useMutation({
    mutationFn: async () => unwrap(await window.zima.cancelPhotoBackup({})),
    onSuccess: () => void status.refetch(),
  })

  const state = status.data
  const error = asAppError(start.error ?? pick.error ?? cancel.error)
  const running = state?.phase === 'scanning' || state?.phase === 'uploading'

  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        <CloudIcon />
        <p className="text-sm font-medium">{t('backup.title')}</p>
        <Badge>{t('backup.foregroundOnly')}</Badge>
      </div>
      <Muted className="mb-3">{t('backup.explainer', { destination })}</Muted>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => pick.mutate()} disabled={running}>
          {t('backup.pickFolders')}
        </Button>
        <Button
          onClick={() => start.mutate()}
          disabled={running || sources.length === 0 || start.isPending}
        >
          <UploadIcon />
          {t('backup.start', { count: sources.length })}
        </Button>
        {running && (
          <Button variant="danger" onClick={() => cancel.mutate()}>
            {t('backup.cancel')}
          </Button>
        )}
      </div>

      {sources.length > 0 && (
        <ul className="mb-3 flex flex-col gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {sources.map((source) => (
            <li key={source} className="truncate font-mono">
              {source}
            </li>
          ))}
        </ul>
      )}

      {error !== null && <ErrorNote message={t(error.i18nKey)} detail={errorDetail(error)} />}

      {state !== undefined && state.phase !== 'idle' && (
        <>
          <Pill className="mb-3">
            <span className="text-sm font-medium">{t(`backup.phase.${state.phase}`)}</span>
            <span className="ml-auto text-sm" style={{ color: 'var(--text-muted)' }}>
              {t('backup.counts', {
                uploaded: state.uploaded,
                total: state.total,
                skipped: state.skipped,
                failed: state.failed,
              })}
            </span>
          </Pill>

          <div
            className="mb-2 h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--surface-sunken)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                background: 'var(--accent)',
                // Guarded against a zero total: 0/0 would be NaN and the bar would vanish
                // rather than sit at zero.
                width: `${state.bytesTotal > 0 ? Math.min(100, (state.bytesSent / state.bytesTotal) * 100) : 0}%`,
              }}
            />
          </div>
          <Muted>
            {formatBytes(state.bytesSent, i18n.language)} / {formatBytes(state.bytesTotal, i18n.language)}
            {state.currentFile !== null ? ` · ${state.currentFile}` : ''}
          </Muted>

          {state.notes.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm">
                {t('backup.notes', { count: state.notes.length })}
              </summary>
              <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs">
                {state.notes.map((note, index) => (
                  <li key={`${note.file}-${index}`}>
                    <span
                      style={{
                        color: note.outcome === 'failed' ? 'var(--danger)' : 'var(--text-muted)',
                      }}
                    >
                      {t(`backup.outcome.${note.outcome}`)}
                    </span>{' '}
                    <span className="font-mono">{note.file}</span>
                    <span style={{ color: 'var(--text-muted)' }}> — {note.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  )
}
