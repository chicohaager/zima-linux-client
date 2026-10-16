import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Device, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { Card, Muted, SectionTitle } from '../../shared/ui/Card'
import { Button, ErrorNote } from '../../shared/ui/Controls'
import { SearchIcon } from '../../shared/ui/Icons'
import { DeviceList } from './DeviceList'
import { DiscoveryResults } from './DiscoveryResults'
import { PathOffer } from './PathOffer'
import { RemoteIdCard } from './RemoteIdCard'
import type { SignInTarget } from './signInTarget'
import { SessionCard } from '../session/SessionCard'
import { SignInForm } from '../session/SignInForm'
import { useResume } from '../session/useResume'
import { DashboardCards } from './DashboardCards'
import { PowerActions } from './PowerActions'
import { TailscalePanel } from '../settings/TailscalePanel'
import { ZerotierPanel } from '../settings/ZerotierPanel'
import { LegacyImportPanel } from '../settings/LegacyImportPanel'
import { LogFolderButton } from '../settings/LogFolderButton'
import { asAppError, errorMessage, unwrap } from '../../shared/lib/ipc'

/**
 * The device screen: active session, saved devices, and the three ways to add one.
 *
 * Discovery and probing both happen in the main process; everything shown here is a
 * measured value (mDNS answer, real round-trip time, route table) rather than an
 * inference from an address or an OS version.
 */
export const DeviceScreen = (): React.JSX.Element => {
  const { t } = useTranslation()
  // Restores a stored session before the user has to do anything. Its outcome is rendered
  // below, because a failed restore that says nothing looks like an unexplained logout.
  const resume = useResume()
  const [target, setTarget] = useState<SignInTarget | null>(null)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [found, setFound] = useState<readonly { device: DiscoveredDevice; probe: ProbeResult }[] | null>(
    null,
  )

  // The dashboard, the power actions and the ZeroTier panel only make sense with a session,
  // so they are mounted from its presence rather than hidden behind disabled buttons.
  const session = useQuery({
    queryKey: ['session', 'current'],
    queryFn: async () => unwrap(await window.zima.currentSession({})),
    retry: false,
  })
  /*
   * 🔴 The LIVE answer, not the last one that worked.
   *
   * react-query keeps `data` from the last successful fetch when a later one fails. The
   * screen was gated on `session.data !== undefined`, so after the session went away the
   * dashboard kept rendering from that stale copy — while its own sub-queries, which need a
   * token, each put up "Please sign in." Seen on a real desktop on 2026-08-10: storage
   * figures and Restart/Power-off buttons next to two identical "no active session"
   * banners. A screen may not claim two contradictory things at once, and offering to power
   * off a machine there is no session for is worse than useless.
   */
  const signedIn = session.status === 'success' && session.data !== undefined
  const zerotier = session.data?.capabilities?.zerotier
  const deviceNetworkId =
    zerotier !== undefined && zerotier !== 'unknown' && 'networkId' in zerotier
      ? zerotier.networkId
      : null

  const scan = useMutation({
    mutationFn: async () => {
      const response = await window.zima.scanNetwork({ timeoutMs: 3_000 })
      if (!response.ok) throw response.error
      return Promise.all(
        response.value.map(async (device) => {
          const probe = await window.zima.probeHost({ host: device.host, port: device.port })
          return {
            device,
            probe: probe.ok
              ? probe.value
              : {
                  host: device.host,
                  reachable: false,
                  latencyMs: null,
                  failure: 'timeout' as const,
                  httpStatus: null,
                },
          }
        }),
      )
    },
    onSuccess: setFound,
  })


  if (target !== null) {
    return (
      <SignInForm
        initialHost={target.host}
        initialPort={target.port}
        kind={target.kind}
        displayName={target.displayName}
        networkId={target.networkId}
        onCancel={() => setTarget(null)}
        onSignedIn={() => setTarget(null)}
      />
    )
  }

  const scanError = asAppError(scan.error)

  return (
    <>
      <SectionTitle>{t('device.title')}</SectionTitle>

      <SessionCard />

      {signedIn && session.data !== undefined && (
        <>
          <DashboardCards />
          <PowerActions
            deviceId={session.data.deviceId}
            deviceName={session.data.displayName}
          />
          <ZerotierPanel suggestedNetworkId={deviceNetworkId} />
        </>
      )}

      {resume.state.phase === 'running' && (
        <Card className="mb-4">
          <Muted>{t('signIn.resuming')}</Muted>
        </Card>
      )}

      {/* A stored token that fails to restore is named, with the technical reason
          underneath. "nothing-stored" is deliberately silent — that is a fresh install,
          not a fault. */}
      {resume.state.phase === 'failed' && (
        <div className="mb-4">
          <ErrorNote
            message={`${t('signIn.resumeFailed')} ${errorMessage(t, resume.state.error)}`}
            detail={
              resume.state.error.context === undefined
                ? undefined
                : Object.entries(resume.state.error.context)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join('  ')
            }
          />
          {/* Directly under the failure, because this is the one actionable thing at that
              moment: the device may be standing in this network under an address that was
              never stored. Asks, never adopts — see PathOffer. The failure travels with it:
              the card carries a sentence about reachability and must stay silent for a
              failure that was not about reachability (a 401 is not a dead path). */}
          {resume.state.deviceId !== null && (
            <PathOffer deviceId={resume.state.deviceId} resumeError={resume.state.error} />
          )}
        </div>
      )}

      <DeviceList
        onConnect={(device: Device) => {
          /*
           * 🔴 This button is now the ONLY thing that reaches out to a stored device.
           *
           * The stored token is tried first, because that is what "connect" means for a
           * device you have used before — and only when there is none, or it no longer
           * works, does the form appear. Nothing happens before this click: an unasked-for
           * restore decides for the user which tunnel comes up.
           */
          void (async () => {
            const outcome = await resume.start(device.id)
            if (outcome.phase === 'done') return
            // 'failed' keeps its banner and its path offer above; a missing secret is not a
            // fault, it is the normal case for a device that was only ever scanned.
            if (outcome.phase !== 'nothing-stored') return

            const address = [...device.addresses].sort((a, b) => a.priority - b.priority)[0]
            if (address !== undefined) {
              setTarget({
                host: address.host,
                port: address.port,
                // 🔴 The kind is KEPT, not downgraded to 'direct'. A saved remote-id address
                // is a number inside a tunnel; calling it 'direct' loses the one fact needed
                // to reopen that tunnel, and the sign-in then runs into a full timeout.
                kind: address.kind,
                displayName: device.displayName,
                ...(address.networkId === undefined ? {} : { networkId: address.networkId }),
              })
            }
          })()
        }}
      />

      {/* Offered next to the LAN scan, not instead of it: a machine can be on the LAN and
          on a tailnet at once, and the probe ranks whichever answers faster. */}
      <TailscalePanel
        onUse={(host, displayName) =>
          setTarget({ host, port: 80, kind: 'tailscale', displayName })
        }
      />

      <div className="mb-4 flex flex-col gap-2">
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          <SearchIcon />
          {scan.isPending ? t('device.scanning') : t('device.scan')}
        </Button>
        <Button
          variant="secondary"
          data-action="direct-ip"
          onClick={() => setTarget({ host: '', port: 80, kind: 'direct' })}
        >
          {t('device.directIp')}
        </Button>
        {/* The third way in, on the same footing as the other two. It used to exist only as
            a ZeroTier network-management panel further down the screen, which is not how
            anyone thinks about it: you have an ID, you want to reach your device. */}
        <Button
          variant="secondary"
          data-action="remote-id"
          onClick={() => setRemoteOpen((open) => !open)}
        >
          {t('device.remoteId')}
        </Button>
      </div>

      {/* Hidden, not unmounted: closing the card keeps what was typed into it, as it did
          while this state still lived in DeviceScreen (decided 2026-10-16). The card's own
          success path still empties the fields. */}
      <div hidden={!remoteOpen}>
        <RemoteIdCard
          onConnected={(next) => {
            setRemoteOpen(false)
            setTarget(next)
          }}
        />
      </div>

      {scanError !== null && <ErrorNote message={errorMessage(t, scanError)} />}

      {/* An empty result is explained, never left as a blank list: mDNS is routinely
          blocked between network segments, which is not the same as "no device here". */}
      {found !== null && found.length === 0 && (
        <Card>
          <p className="font-medium">{t('device.nothingAnswered')}</p>
          <Muted className="mt-1">{t('device.nothingAnsweredHint')}</Muted>
        </Card>
      )}

      <LegacyImportPanel />
      <LogFolderButton />

      {found !== null && found.length > 0 && (
        <DiscoveryResults
          results={found}
          onPick={(device) =>
            setTarget({
              host: device.host,
              port: device.port,
              kind: 'lan',
              displayName: device.name,
            })
          }
        />
      )}
    </>
  )
}
