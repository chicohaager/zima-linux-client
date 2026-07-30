import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import type { Device, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { Card, Muted, SectionTitle } from '../../shared/ui/Card'
import { Button, ErrorNote } from '../../shared/ui/Controls'
import { SearchIcon } from '../../shared/ui/Icons'
import { DeviceList } from './DeviceList'
import { DiscoveryResults } from './DiscoveryResults'
import { SessionCard } from '../session/SessionCard'
import { SignInForm } from '../session/SignInForm'

interface SignInTarget {
  readonly host: string
  readonly port: number
  readonly kind: 'lan' | 'direct'
  readonly displayName?: string
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
  const [target, setTarget] = useState<SignInTarget | null>(null)
  const [found, setFound] = useState<readonly { device: DiscoveredDevice; probe: ProbeResult }[] | null>(
    null,
  )

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
        onCancel={() => setTarget(null)}
      />
    )
  }

  const scanError = scan.error as { i18nKey?: string } | null

  return (
    <>
      <SectionTitle>{t('device.title')}</SectionTitle>

      <SessionCard />

      <DeviceList
        onConnect={(device: Device) => {
          const address = [...device.addresses].sort((a, b) => a.priority - b.priority)[0]
          if (address !== undefined) {
            setTarget({
              host: address.host,
              port: address.port,
              kind: address.kind === 'remote-id' ? 'direct' : address.kind,
              displayName: device.displayName,
            })
          }
        }}
      />

      <div className="mb-4 flex flex-col gap-2">
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          <SearchIcon />
          {scan.isPending ? t('device.scanning') : t('device.scan')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setTarget({ host: '', port: 80, kind: 'direct' })}
        >
          {t('device.directIp')}
        </Button>
      </div>

      {scanError !== null && <ErrorNote message={t(scanError.i18nKey ?? 'error.internal')} />}

      {/* An empty result is explained, never left as a blank list: mDNS is routinely
          blocked between network segments, which is not the same as "no device here". */}
      {found !== null && found.length === 0 && (
        <Card>
          <p className="font-medium">{t('device.nothingAnswered')}</p>
          <Muted className="mt-1">{t('device.nothingAnsweredHint')}</Muted>
        </Card>
      )}

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
