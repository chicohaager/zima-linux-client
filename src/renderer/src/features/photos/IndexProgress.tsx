import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Muted, Pill } from '../../shared/ui/Card'
import { unwrap } from '../../shared/lib/ipc'

/**
 * The indexing state of the photos module — the progress pill of the mobile client's Photos
 * screen, and more than decoration.
 *
 * It is here because of a measured property: until the semantic index is built, text search
 * is token-exact (`"flug"` finds `Chiemseeflug.mp4`, `"Chiemsee"` does not). Without this
 * line on screen, an empty result set looks like a broken search rather than an unfinished
 * index — and the user would go hunting in the wrong place.
 *
 * Renders nothing while the state is unknown: a pill saying "0 %" for something we have not
 * measured would be worse than no pill.
 */
export const IndexProgress = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const progress = useQuery({
    queryKey: ['photos', 'progress'],
    queryFn: async () => unwrap(await window.zima.photoIndexProgress({})),
    // While indexing runs the numbers move; when it is finished they do not.
    refetchInterval: (query) => (query.state.data?.status === 'idle' ? false : 5_000),
  })

  const state = progress.data
  if (state === undefined) return null

  const total = state.totalImages + state.totalVideos
  const processed = state.processedImages + state.processedVideos
  const pending = state.pendingImages + state.pendingVideos
  // The semantic stage is the one that decides whether natural-language search works, so it
  // is named separately instead of being averaged into an overall percentage.
  const semantic = state.stages.find((stage) => stage.kind === 'nn')

  return (
    <div className="mb-4">
      <Pill>
        <span className="text-sm font-medium">
          {t('photos.indexed', { processed, total })}
        </span>
        {pending > 0 && (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('photos.pending', { count: pending })}
          </span>
        )}
        <span className="ml-auto text-sm" style={{ color: 'var(--text-muted)' }}>
          {t(`photos.indexStatus.${state.status === 'idle' ? 'idle' : 'working'}`)}
        </span>
      </Pill>

      {semantic !== undefined && semantic.percentage < 100 && (
        <Muted className="mt-1.5">
          {t('photos.semanticIncomplete', { percent: semantic.percentage })}
        </Muted>
      )}
    </div>
  )
}
