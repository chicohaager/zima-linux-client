import { useTranslation } from 'react-i18next'
import type { DiscoveredDevice, ProbeResult } from '@shared/domain'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge, Button } from '../../shared/ui/Controls'
import { WifiIcon } from '../../shared/ui/Icons'

/**
 * Devices found on the LAN, each with the outcome of a real request.
 *
 * The failure reason is shown verbatim per candidate instead of a single "offline":
 * "nothing is listening on this port" and "no answer at all" call for different action,
 * and collapsing them sends people after the wrong problem.
 */
export const DiscoveryResults = ({
  results,
  onPick,
}: {
  readonly results: readonly { device: DiscoveredDevice; probe: ProbeResult }[]
  readonly onPick: (device: DiscoveredDevice) => void
}): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('device.found', { count: results.length })}</h2>
      {results.map(({ device, probe }) => (
        <Card key={`${device.host}:${device.port}`}>
          <div className="flex items-center gap-2">
            <span style={{ color: probe.reachable ? 'var(--success)' : 'var(--danger)' }}>
              <WifiIcon />
            </span>
            <span className="font-medium">{device.name}</span>
            <Badge>{t('device.connection.lan')}</Badge>
            <span className="ml-auto tabular-nums text-sm" style={{ color: 'var(--text-muted)' }}>
              {probe.reachable && probe.latencyMs !== null
                ? t('device.latency', { ms: probe.latencyMs })
                : t(`error.${probe.failure ?? 'internal'}`)}
            </span>
          </div>

          <Muted className="mt-1 font-mono text-xs">
            {device.host}:{device.port}
            {device.txt['os'] === undefined ? '' : ` · os=${device.txt['os']}`}
          </Muted>

          <div className="mt-3">
            <Button onClick={() => onPick(device)} disabled={!probe.reachable}>
              {t('devices.connect')}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
