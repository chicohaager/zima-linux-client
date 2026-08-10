import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Button, ErrorNote } from '../../shared/ui/Controls'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'

/**
 * Adopting devices from a 0.9.x installation — Plan § 13.
 *
 * The panel says out loud what is and is not taken over: addresses yes, passwords no. That is
 * not a limitation to apologise for — moving a secret between keyring backends behind the
 * user's back would be a quiet breach of trust, so v2 asks once instead.
 *
 * Renders nothing when no old profile exists, which is the normal case for a new user. An
 * empty "migration" card would suggest something went wrong.
 */
export const LegacyImportPanel = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const client = useQueryClient()

  const profiles = useQuery({
    queryKey: ['legacy', 'profiles'],
    queryFn: async () => unwrap(await window.zima.scanLegacyProfiles({})),
  })

  const adopt = useMutation({
    mutationFn: async (directory: string) =>
      unwrap(await window.zima.importLegacyProfile({ directory })),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  const error = asAppError(profiles.error ?? adopt.error)
  const found = (profiles.data ?? []).filter(
    (profile) => profile.connections > 0 || profile.host !== null,
  )
  if (found.length === 0 && error === null) return null

  return (
    <Card className="mb-4">
      <p className="mb-1 text-sm font-medium">{t('legacy.title')}</p>
      <Muted className="mb-3">{t('legacy.explainer')}</Muted>

      <ul className="flex flex-col gap-2">
        {found.map((profile) => (
          <li key={profile.directory} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">{profile.directory}</span>
              <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('legacy.summary', {
                  connections: profile.connections,
                  jobs: profile.backupJobs,
                  host: profile.host ?? '—',
                })}
              </span>
            </span>
            <Button
              variant="secondary"
              disabled={adopt.isPending}
              onClick={() => adopt.mutate(profile.directory)}
            >
              {t('legacy.adopt')}
            </Button>
          </li>
        ))}
      </ul>

      {adopt.data !== undefined && (
        <Muted className="mt-2">
          {t('legacy.result', { imported: adopt.data.imported, skipped: adopt.data.skipped })}
        </Muted>
      )}

      {error !== null && (
        <div className="mt-2">
          <ErrorNote message={errorMessage(t, error)} detail={errorDetail(error)} />
        </div>
      )}
    </Card>
  )
}
