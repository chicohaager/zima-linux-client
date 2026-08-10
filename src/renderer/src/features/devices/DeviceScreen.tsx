import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ConnectionKind, Device, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { Card, Muted, SectionTitle } from '../../shared/ui/Card'
import { Button, ErrorNote, Field } from '../../shared/ui/Controls'
import { SearchIcon } from '../../shared/ui/Icons'
import { DeviceList } from './DeviceList'
import { DiscoveryResults } from './DiscoveryResults'
import { PathOffer } from './PathOffer'
import { SessionCard } from '../session/SessionCard'
import { SignInForm } from '../session/SignInForm'
import { useAutoResume } from '../session/useAutoResume'
import { DashboardCards } from './DashboardCards'
import { PowerActions } from './PowerActions'
import { TailscalePanel } from '../settings/TailscalePanel'
import { ZerotierPanel } from '../settings/ZerotierPanel'
import { LegacyImportPanel } from '../settings/LegacyImportPanel'
import { LogFolderButton } from '../settings/LogFolderButton'
import { asAppError, errorDetail, unwrap } from '../../shared/lib/ipc'

interface SignInTarget {
  readonly host: string
  readonly port: number
  readonly kind: ConnectionKind
  readonly displayName?: string
  /** The Remote ID, kept so it can be stored with the address and reopened later. */
  readonly networkId?: string
}

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
  const resume = useAutoResume()
  const [target, setTarget] = useState<SignInTarget | null>(null)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [remoteId, setRemoteId] = useState('')
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

  // Remote ID: one step for the user — type the ID, then sign in. The join, the address
  // derivation and the probe all happen behind this single mutation, because none of them
  // is a decision the user makes.
  const remote = useMutation({
    mutationFn: async (id: string) => unwrap(await window.zima.connectRemoteId({ remoteId: id })),
    onSuccess: (result) => {
      setRemoteOpen(false)
      setRemoteId('')
      setTarget({
        host: result.host,
        port: result.port,
        kind: 'remote-id',
        // The ID the user typed IS the ZeroTier network. Kept so it reaches storage — the
        // derived 10.x.y.1 is worthless on the next start without it.
        networkId: remoteId.trim().toLowerCase(),
        // Spread rather than an `undefined` value: exactOptionalPropertyTypes draws a line
        // between "absent" and "present but undefined", and this side of it is absent.
        ...(result.networkName.length > 0 ? { displayName: result.networkName } : {}),
      })
    },
  })
  const remoteError = asAppError(remote.error)

  // Offered only when the failure is the missing capability — a button that appears for
  // every error would invite people to grant privileges against unrelated problems.
  const [copied, setCopied] = useState(false)
  // Installs this app's own copy and reports what is still missing. It does NOT grant the
  // capability — see provision.ts for why that is neither possible from here nor desirable.
  const provision = useMutation({
    mutationFn: async () => unwrap(await window.zima.zerotierProvision({})),
    onSuccess: () => setCopied(false),
  })
  const provisionError = asAppError(provision.error)
  const needsCapability =
    remoteError !== null && remoteError.kind === 'capability-missing' &&
    remoteError.message.includes('virtual network device')

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

  const scanError = scan.error as { i18nKey?: string } | null

  return (
    <>
      <SectionTitle>{t('device.title')}</SectionTitle>

      <SessionCard />

      {session.data !== undefined && (
        <>
          <DashboardCards />
          <PowerActions
            deviceId={session.data.deviceId}
            deviceName={session.data.displayName}
          />
          <ZerotierPanel suggestedNetworkId={deviceNetworkId} />
        </>
      )}

      {resume.phase === 'running' && (
        <Card className="mb-4">
          <Muted>{t('signIn.resuming')}</Muted>
        </Card>
      )}

      {/* A stored token that fails to restore is named, with the technical reason
          underneath. "nothing-stored" is deliberately silent — that is a fresh install,
          not a fault. */}
      {resume.phase === 'failed' && (
        <div className="mb-4">
          <ErrorNote
            message={`${t('signIn.resumeFailed')} ${t(resume.error.i18nKey)}`}
            detail={
              resume.error.context === undefined
                ? undefined
                : Object.entries(resume.error.context)
                    .map(([key, value]) => `${key}=${String(value)}`)
                    .join('  ')
            }
          />
          {/* Directly under the failure, because this is the one actionable thing at that
              moment: the device may be standing in this network under an address that was
              never stored. Asks, never adopts — see PathOffer. The failure travels with it:
              the card carries a sentence about reachability and must stay silent for a
              failure that was not about reachability (a 401 is not a dead path). */}
          {resume.deviceId !== null && (
            <PathOffer deviceId={resume.deviceId} resumeError={resume.error} />
          )}
        </div>
      )}

      <DeviceList
        onConnect={(device: Device) => {
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

      {remoteOpen && (
        <Card className="mb-4">
          <p className="font-medium">{t('device.remoteIdTitle')}</p>
          <Muted className="mt-1">{t('device.remoteIdHint')}</Muted>
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (/^[0-9a-fA-F]{16}$/.test(remoteId.trim())) remote.mutate(remoteId.trim())
            }}
          >
            <div className="min-w-56 flex-1">
              <Field
                name="remoteId"
                label={t('device.remoteIdLabel')}
                value={remoteId}
                onChange={setRemoteId}
                placeholder="0123456789abcdef"
              />
            </div>
            <Button
              type="submit"
              disabled={remote.isPending || !/^[0-9a-fA-F]{16}$/.test(remoteId.trim())}
            >
              {remote.isPending ? t('device.remoteIdConnecting') : t('device.connect')}
            </Button>
          </form>
          {remoteError !== null && (
            <div className="mt-3">
              <ErrorNote
                message={t(remoteError.i18nKey ?? 'error.internal')}
                detail={errorDetail(remoteError)}
              />
            </div>
          )}
          {needsCapability && (
            <div className="mt-3">
              <Muted className="mb-2">{t('zerotier.provisionHint')}</Muted>
              {provision.data === undefined ? (
                <Button onClick={() => provision.mutate()} disabled={provision.isPending}>
                  {provision.isPending ? t('zerotier.provisioning') : t('zerotier.provision')}
                </Button>
              ) : provision.data.capable === true ? (
                <>
                  <Muted className="mb-2">{t('zerotier.capable')}</Muted>
                  <Button onClick={() => remote.mutate(remoteId.trim())}>
                    {t('zerotier.recheck')}
                  </Button>
                </>
              ) : (
                <>
                  {/* The command is shown, not run. This app cannot execute it — its own
                      process tree has no_new_privs set, so the kernel ignores the setuid bit
                      on pkexec/sudo for anything it launches — and it should not want to:
                      an application that raises its own password dialog teaches people to
                      type their password at whatever asks. */}
                  <Muted className="mb-2">{t('zerotier.commandHint')}</Muted>
                  <code className="mb-2 block overflow-x-auto rounded bg-black/5 p-2 font-mono text-xs select-all dark:bg-white/10">
                    {provision.data.command}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(provision.data.command)
                        setCopied(true)
                      }}
                    >
                      {copied ? t('zerotier.copied') : t('zerotier.copy')}
                    </Button>
                    <Button onClick={() => remote.mutate(remoteId.trim())} disabled={remote.isPending}>
                      {t('zerotier.recheck')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
          {provisionError !== null && (
            <div className="mt-3">
              <ErrorNote
                message={t(provisionError.i18nKey ?? 'error.internal')}
                detail={errorDetail(provisionError)}
              />
            </div>
          )}
        </Card>
      )}

      {scanError !== null && <ErrorNote message={t(scanError.i18nKey ?? 'error.internal')} />}

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
