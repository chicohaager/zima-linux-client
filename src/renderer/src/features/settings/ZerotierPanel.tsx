import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote, Field } from '../../shared/ui/Controls'
import { asAppError, errorDetail, unwrap } from '../../shared/lib/ipc'

/**
 * Remote ID over ZeroTier — Plan § 3b.
 *
 * What this panel shows is the LOCAL daemon's state: our node id and the networks this
 * machine has joined, read from the daemon's own API. That is the honest source — the device's
 * `/zt/info` says what the DEVICE is connected to, which is a different question and is shown
 * on the capability list.
 *
 * The network status word comes through verbatim (`OK`, `REQUESTING_CONFIGURATION`,
 * `ACCESS_DENIED`). Translating `ACCESS_DENIED` into "not connected" would hide the one thing
 * the user has to do: authorise this node in the network's controller.
 */
export const ZerotierPanel = ({
  suggestedNetworkId,
}: {
  /** The network the active device reports being on — the one worth joining. */
  readonly suggestedNetworkId: string | null
}): React.JSX.Element => {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [networkId, setNetworkId] = useState(suggestedNetworkId ?? '')

  const state = useQuery({
    queryKey: ['zerotier', 'state'],
    queryFn: async () => unwrap(await window.zima.zerotierState({})),
  })

  const invalidate = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: ['zerotier'] })
  }

  const join = useMutation({
    mutationFn: async (id: string) => unwrap(await window.zima.zerotierJoin({ networkId: id })),
    onSuccess: invalidate,
  })
  const leave = useMutation({
    mutationFn: async (id: string) => unwrap(await window.zima.zerotierLeave({ networkId: id })),
    onSuccess: invalidate,
  })

  const error = asAppError(state.error ?? join.error ?? leave.error)
  const runtime = state.data

  return (
    <Card className="mb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t('zerotier.title')}</p>
        {runtime !== undefined && (
          <>
            <Badge tone={runtime.running ? 'success' : 'neutral'}>
              {t(runtime.running ? 'zerotier.running' : 'zerotier.notRunning')}
            </Badge>
            <Badge>{t(`zerotier.daemon.${runtime.daemon}`)}</Badge>
          </>
        )}
      </div>

      {runtime?.nodeId !== null && runtime?.nodeId !== undefined && (
        <Muted className="mb-2">{t('zerotier.nodeId', { id: runtime.nodeId })}</Muted>
      )}

      {/* A state we could not establish says so, with the reason. "Not connected" would be a
          claim we did not measure. */}
      {runtime?.problem !== null && runtime?.problem !== undefined && <Muted className="mb-2">{runtime.problem}</Muted>}

      {runtime !== undefined && runtime.networks.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {runtime.networks.map((network) => (
            <li key={network.networkId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{network.networkId}</span>
              <span>{network.name}</span>
              <Badge tone={network.status === 'OK' ? 'success' : 'neutral'}>{network.status}</Badge>
              {/* The measured type, because it decides whether a join needs approving at
                  all. Shown rather than described: PUBLIC networks — which is what
                  IceWhale-RemoteAccess is — admit any node immediately. */}
              {network.type !== 'UNKNOWN' && <Badge>{network.type}</Badge>}
              {network.assignedAddresses.length > 0 && (
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  {network.assignedAddresses.join(', ')}
                </span>
              )}
              <Button
                variant="secondary"
                className="ml-auto"
                disabled={leave.isPending}
                onClick={() => leave.mutate(network.networkId)}
              >
                {t('zerotier.leave')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <Field
            name="networkId"
            label={t('zerotier.networkId')}
            value={networkId}
            onChange={setNetworkId}
            placeholder="0123456789abcdef"
          />
        </div>
        <Button
          disabled={join.isPending || !/^[0-9a-fA-F]{16}$/.test(networkId)}
          onClick={() => join.mutate(networkId)}
        >
          {t('zerotier.join')}
        </Button>
      </div>
      {/* 🔴 This used to be an unconditional sentence claiming the network's owner has to
          authorise this machine. That is true of PRIVATE networks and false of PUBLIC ones —
          and every IceWhale-RemoteAccess membership measured on 2026-07-30 was PUBLIC with
          status OK, so the client told users to wait for an approval that never comes.
          Reported as wrong by the user, correctly. Now it appears only for a network that is
          actually in that state. */}
      {runtime?.networks.some((network) => network.status === 'ACCESS_DENIED') === true && (
        <Muted className="mt-2">{t('zerotier.hintAccessDenied')}</Muted>
      )}
      <Muted className="mt-2">{t('zerotier.hint')}</Muted>

      {error !== null && (
        <div className="mt-2">
          <ErrorNote message={t(error.i18nKey)} detail={errorDetail(error)} />
        </div>
      )}
    </Card>
  )
}
