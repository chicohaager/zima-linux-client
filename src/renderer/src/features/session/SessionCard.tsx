import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Muted, Pill } from '../../shared/ui/Card'
import { Badge, Button } from '../../shared/ui/Controls'
import { WifiIcon } from '../../shared/ui/Icons'
import { CapabilityList } from '../devices/CapabilityList'
import { useNow } from '../../shared/lib/useNow'

/**
 * The active session, laid out like the mobile client's device screen: account line,
 * device name, connection pill with the path and its measured latency, then the feature
 * list derived from the device's own route table.
 *
 * The remaining session lifetime is shown rather than hidden — a token that quietly
 * expires produces "it suddenly stopped working" reports.
 */
export const SessionCard = (): React.JSX.Element | null => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const now = useNow()

  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const response = await window.zima.currentSession({})
      // Not signed in is a normal state, not an error to shout about.
      return response.ok ? response.value : null
    },
    refetchInterval: 60_000,
  })

  const signOut = useMutation({
    mutationFn: async () => {
      const response = await window.zima.signOut({})
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })

  const data = session.data
  if (data === undefined || data === null) return null

  const minutesLeft = Math.max(0, Math.round((data.accessExpiresAtMs - now) / 60_000))

  return (
    <div className="mb-4">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
          aria-hidden
        >
          {data.username.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <p className="font-medium">{data.displayName}</p>
          <Muted>{t('signIn.signedInAs', { username: data.username, role: data.role })}</Muted>
        </div>
        {/* The one reliable, locale-independent answer to "is a session open?". The tour
            used to decide that by looking for the words "Abmelden" or "Sign out", which is
            wrong in 26 of the 28 catalogues. */}
        <Button
          variant="secondary"
          className="ml-auto"
          data-action="sign-out"
          onClick={() => signOut.mutate()}
        >
          {t('signIn.signOut')}
        </Button>
      </div>

      <Pill className="mb-3">
        <span style={{ color: 'var(--success)' }}>
          <WifiIcon />
        </span>
        <span className="font-medium">{t(`device.connection.${data.kind}`)}</span>
        <span className="ml-auto font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
          {data.host}:{data.port}
        </span>
      </Pill>

      <Card className="mb-3">
        <div className="flex items-center gap-2 text-sm">
          <Badge tone={minutesLeft > 5 ? 'success' : 'neutral'}>
            {t('signIn.expiresIn', { minutes: minutesLeft })}
          </Badge>
        </div>
      </Card>

      {data.capabilities !== null && <CapabilityList capabilities={data.capabilities} />}
    </div>
  )
}
