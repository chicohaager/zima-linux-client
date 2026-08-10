import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote } from '../../shared/ui/Controls'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'

/**
 * Tailscale — detected, never operated.
 *
 * The contrast with the ZeroTier panel is the point. That one has join and leave, because
 * this client runs its own zerotier-one. This one has neither: if a tunnel is already up,
 * the client uses it and touches nothing else.
 *
 * That restraint answers a reported complaint about the official client: it takes ZeroTier
 * over for remote access and displaces the DNS the user configured, so their AdGuard
 * filtering stops working and they have to choose between the two. A client that only reads
 * the tunnel state cannot take that choice away.
 *
 * The peer list is offered as CANDIDATES, and each is labelled with its own hostname —
 * never as "your ZimaOS". Whether a peer is a ZimaOS device is decided by the probe when
 * the user connects, the same probe LAN and direct addresses go through. Measured on a real
 * tailnet: of four online peers, three answered as ZimaOS — including one called
 * "ZimaBoard", which a name filter would have hidden.
 */
export const TailscalePanel = ({
  onUse,
}: {
  /** Hands a peer address to the sign-in form, exactly like a discovered LAN device. */
  readonly onUse: (host: string, displayName: string) => void
}): React.JSX.Element | null => {
  const { t } = useTranslation()

  const state = useQuery({
    queryKey: ['tailscale', 'state'],
    queryFn: async () => unwrap(await window.zima.tailscaleState({})),
  })

  // Absent Tailscale draws nothing at all: an empty panel on the majority of machines
  // would be noise, and "not installed" is not a problem to report.
  if (state.data !== undefined && !state.data.installed) return null

  const error = state.error === null ? null : asAppError(state.error)

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{t('tailscale.title')}</p>
        {state.data?.backendState !== null && state.data?.backendState !== undefined && (
          <Badge tone={state.data.backendState === 'Running' ? 'success' : 'neutral'}>
            {/* Verbatim from the daemon. "Running", "NeedsLogin" and "Stopped" call for
                different action, and collapsing them into on/off hides which. */}
            {state.data.backendState}
          </Badge>
        )}
      </div>

      <Muted className="mt-1">{t('tailscale.detectedOnly')}</Muted>

      {error !== null && (
        <div className="mt-3">
          <ErrorNote message={errorMessage(t, error)} detail={errorDetail(error)} />
        </div>
      )}

      {/* A stated reason, never an empty list: "could not ask the daemon" and "the tailnet
          has no other machine online" look identical as a blank area and mean opposite
          things. */}
      {state.data?.problem !== null && state.data?.problem !== undefined && (
        <Muted className="mt-2">{state.data.problem}</Muted>
      )}

      {state.data !== undefined && state.data.tailnetName !== null && (
        <Muted className="mt-2">
          {t('tailscale.tailnet', { name: state.data.tailnetName })}
        </Muted>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {(state.data?.peers ?? [])
          .filter((peer) => peer.online)
          .map((peer) => {
            const address = peer.addresses.find((entry) => entry.includes('.'))
            if (address === undefined) return null
            return (
              <li key={address} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{peer.hostName}</p>
                  <Muted className="text-xs">
                    {address} · {peer.os}
                  </Muted>
                </div>
                {/* Addressed by its address, not by its label: the label is translated, and
                    a verification that matches on it only ever checks one locale. Same
                    reason `data-nav` exists on the navigation. */}
                <Button
                  variant="secondary"
                  data-tailscale-use={address}
                  onClick={() => onUse(address, peer.hostName)}
                >
                  {t('tailscale.use')}
                </Button>
              </li>
            )
          })}
      </ul>

      {state.data !== undefined &&
        state.data.problem === null &&
        state.data.peers.filter((peer) => peer.online).length === 0 && (
          <Muted className="mt-2">{t('tailscale.noPeers')}</Muted>
        )}
    </Card>
  )
}
