import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import type { Capabilities, DiscoveredDevice, ProbeResult } from '@shared/domain'
import { Card, Muted, Pill, SectionTitle } from '../../shared/ui/Card'
import { SearchIcon, WifiIcon } from '../../shared/ui/Icons'
import { CapabilityList } from './CapabilityList'

interface Found {
  readonly device: DiscoveredDevice
  readonly probe: ProbeResult
  readonly capabilities: Capabilities | null
  readonly errorKey: string | null
}

/**
 * Device discovery and capability detection.
 *
 * Everything shown here is measured: the mDNS answers, the round-trip time of a real
 * request, and the feature list derived from the device's own gateway route table.
 * Nothing is inferred from the OS version.
 */
export const DeviceScreen = (): React.JSX.Element => {
  const { t } = useTranslation()
  const [results, setResults] = useState<readonly Found[] | null>(null)

  const scan = useMutation({
    mutationFn: async (): Promise<readonly Found[]> => {
      const found = await window.zima.scanNetwork({ timeoutMs: 3_000 })
      if (!found.ok) throw new Error(found.error.i18nKey)

      return Promise.all(
        found.value.map(async (device) => {
          const [probe, caps] = await Promise.all([
            window.zima.probeHost({ host: device.host, port: device.port }),
            window.zima.readCapabilities({ host: device.host, port: device.port }),
          ])
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
            capabilities: caps.ok ? caps.value : null,
            errorKey: caps.ok ? null : caps.error.i18nKey,
          }
        }),
      )
    },
    onSuccess: setResults,
  })

  return (
    <>
      <SectionTitle>{t('device.title')}</SectionTitle>

      <div className="mb-4 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          className="flex items-center justify-center gap-2 rounded-[999px] px-5 py-3.5 font-medium disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          <SearchIcon />
          {scan.isPending ? t('device.scanning') : t('device.scan')}
        </button>
      </div>

      {scan.isError && (
        <Card className="mb-4">
          <p style={{ color: 'var(--danger)' }}>{t(scan.error.message)}</p>
        </Card>
      )}

      {/* An empty result is explained, never left as a blank list. */}
      {results !== null && results.length === 0 && (
        <Card>
          <p className="font-medium">{t('device.nothingAnswered')}</p>
          <Muted className="mt-1">{t('device.nothingAnsweredHint')}</Muted>
        </Card>
      )}

      {results?.map(({ device, probe, capabilities, errorKey }) => (
        <div key={device.host} className="mb-5">
          <h2 className="mb-2 text-xl font-semibold">{device.name}</h2>

          <Pill className="mb-3">
            <span style={{ color: probe.reachable ? 'var(--success)' : 'var(--danger)' }}>
              <WifiIcon />
            </span>
            <span className="font-medium">{t('device.connection.lan')}</span>
            <span className="ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {probe.reachable && probe.latencyMs !== null
                ? t('device.latency', { ms: probe.latencyMs })
                : t(`error.${probe.failure ?? 'internal'}`)}
            </span>
          </Pill>

          {capabilities === null ? (
            <Card>
              <p style={{ color: 'var(--danger)' }}>{t(errorKey ?? 'error.internal')}</p>
            </Card>
          ) : (
            <CapabilityList capabilities={capabilities} />
          )}
        </div>
      ))}
    </>
  )
}
