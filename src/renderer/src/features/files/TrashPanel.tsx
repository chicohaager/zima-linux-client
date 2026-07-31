import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, Muted } from '../../shared/ui/Card'
import { Button, ErrorNote } from '../../shared/ui/Controls'
import { asAppError, errorDetail } from '../../shared/lib/ipc'
import { formatBytes, formatDateTime } from '../../shared/lib/format'
import { useTrash } from './useFiles'

/**
 * The trash.
 *
 * Restore only — emptying the trash is not offered. That is a deliberate omission: it is an
 * irreversible bulk delete, and this client has no undo to put behind it. The device's own
 * web UI has the button; this one does not pretend to be the last word on the user's data.
 */
export const TrashPanel = ({
  onRestore,
}: {
  readonly onRestore: (paths: readonly string[]) => void
}): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const trash = useTrash(true)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const error = asAppError(trash.error)

  const toggle = (path: string): void => {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelected(next)
  }

  return (
    <Card className="mb-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t('files.trash')}</p>
        <Button
          variant="secondary"
          disabled={selected.size === 0}
          onClick={() => {
            onRestore([...selected])
            setSelected(new Set())
          }}
        >
          {t('files.restore', { count: selected.size })}
        </Button>
      </div>

      {trash.isPending && <Muted>{t('files.loading')}</Muted>}
      {error !== null && <ErrorNote message={t(error.i18nKey)} detail={errorDetail(error)} />}
      {trash.data !== undefined && trash.data.length === 0 && <Muted>{t('files.trashEmpty')}</Muted>}

      {trash.data !== undefined && trash.data.length > 0 && (
        <>
          <ul className="flex max-h-72 flex-col overflow-y-auto">
            {trash.data.map((entry) => (
              <li
                key={entry.rawPath}
                className="flex items-center gap-3 py-1.5"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(entry.rawPath)}
                  onChange={() => toggle(entry.rawPath)}
                  aria-label={t('files.select', { name: entry.name })}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{entry.name}</span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatBytes(entry.size, i18n.language)} ·{' '}
                    {t('files.deletedAt', {
                      when: formatDateTime(entry.deletedAtMs, i18n.language),
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <Muted className="mt-2">{t('files.trashCount', { count: trash.data.length })}</Muted>
        </>
      )}
    </Card>
  )
}
