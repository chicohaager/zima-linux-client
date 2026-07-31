import { useTranslation } from 'react-i18next'
import { isImageName, isVisualName, mediaUrl } from '@shared/media'
import { formatBytes, formatDateTime } from '../../shared/lib/format'
import { FolderIcon } from '../../shared/ui/Icons'

export interface Entry {
  readonly name: string
  readonly path: string
  readonly isDir: boolean
  readonly size: number
  readonly modifiedMs: number
}

interface Props {
  readonly entries: readonly Entry[]
  readonly selected: ReadonlySet<string>
  readonly onToggle: (path: string) => void
  readonly onOpen: (entry: Entry) => void
}

/**
 * The directory listing.
 *
 * A thumbnail is requested only for names the thumbnail endpoint can actually render.
 * Asking for one per archive or text file would produce a wall of 404s that looks like a
 * broken device, so `isImageName` decides — and everything else gets a typed icon instead of
 * a grey box.
 */
export const FileList = ({ entries, selected, onToggle, onOpen }: Props): React.JSX.Element => {
  const { t, i18n } = useTranslation()

  return (
    <ul className="flex flex-col">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="flex items-center gap-3 px-1 py-2"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <input
            type="checkbox"
            checked={selected.has(entry.path)}
            onChange={() => onToggle(entry.path)}
            aria-label={t('files.select', { name: entry.name })}
            className="size-4 shrink-0"
          />

          <button
            type="button"
            onClick={() => onOpen(entry)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            {entry.isDir ? (
              <span className="shrink-0" style={{ color: 'var(--folder-to)' }}>
                <FolderIcon />
              </span>
            ) : isImageName(entry.name) ? (
              <img
                src={mediaUrl('thumbnail', entry.path)}
                alt=""
                loading="lazy"
                className="size-9 shrink-0 rounded-md object-cover"
                style={{ background: 'var(--surface-sunken)' }}
              />
            ) : (
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase"
                style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}
              >
                {/* The real extension, not a generic file glyph: it is information the user
                    already has in the name, repeated where it is quick to scan. */}
                {entry.name.includes('.') ? entry.name.split('.').pop()?.slice(0, 4) : '—'}
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{entry.name}</span>
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                {entry.isDir
                  ? formatDateTime(entry.modifiedMs, i18n.language)
                  : `${formatBytes(entry.size, i18n.language)} · ${formatDateTime(entry.modifiedMs, i18n.language)}`}
                {isVisualName(entry.name) && !entry.isDir ? ` · ${t('files.media')}` : ''}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
