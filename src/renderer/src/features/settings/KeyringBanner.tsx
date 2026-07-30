import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { WarningIcon } from '../../shared/ui/Icons'
import { Button } from '../../shared/ui/Controls'

/**
 * Makes the keyring fallback visible and asks before anything is stored.
 *
 * Electron's safeStorage keeps "working" when the system has no secret store: it then
 * encrypts with a hardcoded plaintext password and reports the backend as `basic_text`.
 * A fallback that passes the check hides the problem instead of making it harmless, so
 * the main process refuses to write until the user has answered this question.
 */
export const KeyringBanner = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const status = useQuery({
    queryKey: ['secrets', 'status'],
    queryFn: async () => {
      const response = await window.zima.secretStoreStatus({})
      if (!response.ok) throw response.error
      return response.value
    },
    staleTime: Infinity,
  })

  const consent = useMutation({
    mutationFn: async (granted: boolean) => {
      const response = await window.zima.setPlaintextConsent({ granted })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })

  if (status.data === undefined || !status.data.plaintextRisk) return null

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-2xl p-4"
      style={{ background: 'var(--danger-soft)' }}
    >
      <span style={{ color: 'var(--danger)' }}>
        <WarningIcon />
      </span>
      <div className="flex-1">
        <p className="font-medium">{t('security.keyringTitle')}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('security.keyringPlaintext', { backend: status.data.backend })}
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={() => consent.mutate(true)}>
            {t('security.storeAnyway')}
          </Button>
          <Button variant="secondary" onClick={() => consent.mutate(false)}>
            {t('security.askEveryTime')}
          </Button>
        </div>
      </div>
    </div>
  )
}
