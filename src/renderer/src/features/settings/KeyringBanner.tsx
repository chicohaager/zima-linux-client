import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { WarningIcon } from '../../shared/ui/Icons'

/**
 * Makes the keyring fallback visible.
 *
 * Electron's safeStorage keeps "working" when the system has no secret store: it then
 * encrypts with a hardcoded plaintext password and reports the backend as
 * `basic_text`. A fallback that passes the check hides the problem instead of making
 * it harmless — so the user is told before anything is stored.
 */
export const KeyringBanner = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['secrets', 'status'],
    queryFn: () => window.zima.secretStoreStatus({}),
    staleTime: Infinity,
  })

  if (data === undefined || !data.ok || !data.value.plaintextRisk) return null

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-2xl p-4"
      style={{ background: 'var(--danger-soft)' }}
    >
      <span style={{ color: 'var(--danger)' }}>
        <WarningIcon />
      </span>
      <div>
        <p className="font-medium">{t('security.keyringTitle')}</p>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('security.keyringPlaintext', { backend: data.value.backend })}
        </p>
      </div>
    </div>
  )
}
