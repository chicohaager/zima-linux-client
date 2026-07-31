import { useTranslation } from 'react-i18next'
import { mediaUrl } from '@shared/media'
import { formatDateTime } from '../../shared/lib/format'

export interface GridItem {
  readonly path: string
  readonly name: string
  readonly capturedMs: number
  readonly isVideo: boolean
}

/**
 * The dense grid of the mobile client's Photos screen: edge to edge, minimal gaps.
 *
 * `useLibraryThumbnails` picks the source. With the photos module the module's own thumbnail
 * endpoint gives better crops; without it the files API renders the same grid. Two sources,
 * one appearance — which is what makes Photos usable on a device that has no photos module.
 */
export const PhotoGrid = ({
  items,
  useLibraryThumbnails,
  onOpen,
}: {
  readonly items: readonly GridItem[]
  readonly useLibraryThumbnails: boolean
  readonly onOpen: (item: GridItem) => void
}): React.JSX.Element => {
  const { t, i18n } = useTranslation()

  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item)}
          className="relative aspect-square overflow-hidden rounded-md"
          style={{ background: 'var(--surface-sunken)' }}
          title={`${item.name}${item.capturedMs > 0 ? ` · ${formatDateTime(item.capturedMs, i18n.language)}` : ''}`}
        >
          <img
            src={mediaUrl(useLibraryThumbnails ? 'photo' : 'thumbnail', item.path)}
            alt={item.name}
            loading="lazy"
            className="size-full object-cover"
          />
          {item.isVideo && (
            <span
              className="absolute right-1 bottom-1 rounded px-1 text-[10px] font-semibold"
              style={{ background: 'var(--surface-card)', color: 'var(--text-muted)' }}
            >
              {t('photos.video')}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
