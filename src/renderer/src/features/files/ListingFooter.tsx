import { useTranslation } from 'react-i18next'
import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import type { ResponseOf } from '@shared/contract'
import { Muted } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Controls'

type Listing = Extract<ResponseOf<'files:list'>, { ok: true }>['value']

/**
 * "N of M entries shown" and, while the device has more pages, the button that fetches them.
 *
 * The two belong together: a count that says "500 of 1 200" with no way to the rest is the
 * defect this footer was written for (2026-10-15).
 */
export const ListingFooter = ({
  listing,
}: {
  readonly listing: UseInfiniteQueryResult<Listing>
}): React.JSX.Element | null => {
  const { t } = useTranslation()
  if (listing.data === undefined) return null
  return (
    <>
      <Muted className="mt-3">
        {t('files.countSummary', { shown: listing.data.entries.length, total: listing.data.total })}
      </Muted>
      {listing.hasNextPage && (
        <Button
          variant="secondary"
          className="mt-3"
          disabled={listing.isFetchingNextPage}
          onClick={() => void listing.fetchNextPage()}
        >
          {listing.isFetchingNextPage ? t('files.loading') : t('files.loadMore')}
        </Button>
      )}
    </>
  )
}
