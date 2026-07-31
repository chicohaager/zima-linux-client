import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge, ErrorNote } from '../../shared/ui/Controls'
import { asAppError, errorDetail, unwrap } from '../../shared/lib/ipc'
import { formatBytes, formatPercent } from '../../shared/lib/format'

/**
 * The device dashboard: model, load, storage — the mobile client's "Status" section.
 *
 * Every figure comes from a measured endpoint, and each one is rendered only when the device
 * actually sent it. A missing temperature shows nothing rather than "0 °C", because a
 * fabricated zero is indistinguishable from a real reading.
 */

const Metric = ({
  label,
  value,
  hint,
}: {
  readonly label: string
  readonly value: string
  readonly hint?: string | undefined
}): React.JSX.Element => (
  <Card>
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      {label}
    </p>
    <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    {hint !== undefined && <Muted className="mt-0.5">{hint}</Muted>}
  </Card>
)

export const DashboardCards = (): React.JSX.Element => {
  const { t, i18n } = useTranslation()

  const info = useQuery({
    queryKey: ['system', 'device-info'],
    queryFn: async () => unwrap(await window.zima.deviceInfo({})),
  })
  const load = useQuery({
    queryKey: ['system', 'utilization'],
    queryFn: async () => unwrap(await window.zima.utilization({})),
    // Live figures, so they are polled — but slowly. A one-second poll for a decorative
    // gauge would keep waking a device whose job is to be idle.
    refetchInterval: 5_000,
  })
  const volumes = useQuery({
    queryKey: ['system', 'volumes'],
    queryFn: async () => unwrap(await window.zima.storageVolumes({})),
  })

  const infoError = asAppError(info.error)
  const loadError = asAppError(load.error)
  const volumesError = asAppError(volumes.error)

  return (
    <>
      {info.data !== undefined && (
        <Card className="mb-4">
          <p className="text-lg font-semibold">
            {info.data.name.length > 0 ? info.data.name : t('dashboard.unnamedDevice')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {info.data.model.length > 0 && <Badge>{info.data.model}</Badge>}
            {info.data.osVersion.length > 0 && <Badge>{info.data.osVersion}</Badge>}
            {info.data.arch.length > 0 && <Badge>{info.data.arch}</Badge>}
          </div>
          {info.data.cpuModel.length > 0 && (
            <Muted className="mt-2">
              {t('dashboard.cpu', { model: info.data.cpuModel, cores: info.data.cpuCores })}
            </Muted>
          )}
        </Card>
      )}

      {infoError !== null && (
        <div className="mb-4">
          <ErrorNote message={t(infoError.i18nKey)} detail={errorDetail(infoError)} />
        </div>
      )}

      {load.data !== undefined && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Metric
            label={t('dashboard.cpuLoad')}
            value={`${formatPercent(load.data.cpuPercent, i18n.language)} %`}
            hint={
              load.data.cpuPowerWatt === null
                ? undefined
                : // One decimal: an idle CPU draws a few watts, and rounding to whole
                  // numbers turns 0.4 W into "0 W" — which reads as "no measurement".
                  t('dashboard.watt', { watt: load.data.cpuPowerWatt.toFixed(1) })
            }
          />
          {/* Rendered only when the device reported it: many boards have no sensor, and a
              hardcoded 0 °C would look like a broken reading. */}
          {load.data.cpuTemperature !== null && (
            <Metric
              label={t('dashboard.cpuTemperature')}
              value={`${load.data.cpuTemperature} °C`}
            />
          )}
          <Metric
            label={t('dashboard.memory')}
            value={`${formatPercent(load.data.memoryPercent, i18n.language)} %`}
            hint={`${formatBytes(load.data.memoryUsed, i18n.language)} / ${formatBytes(load.data.memoryTotal, i18n.language)}`}
          />
          {load.data.systemDiskSize > 0 && (
            <Metric
              label={t('dashboard.systemDisk')}
              value={formatBytes(load.data.systemDiskSize - load.data.systemDiskUsed, i18n.language)}
              hint={t('dashboard.freeOf', {
                total: formatBytes(load.data.systemDiskSize, i18n.language),
              })}
            />
          )}
        </div>
      )}

      {loadError !== null && (
        <div className="mb-4">
          <ErrorNote message={t(loadError.i18nKey)} detail={errorDetail(loadError)} />
        </div>
      )}

      {volumes.data !== undefined && volumes.data.length > 0 && (
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium">{t('dashboard.storage')}</p>
          <ul className="flex flex-col gap-3">
            {volumes.data.map((volume) => {
              const used = volume.sizeBytes > 0 ? (volume.usedBytes / volume.sizeBytes) * 100 : 0
              return (
                <li key={volume.path}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{volume.name}</span>
                    {!volume.healthy && (
                      <span style={{ color: 'var(--danger)' }}>{t('dashboard.unhealthy')}</span>
                    )}
                    <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                      {t('dashboard.usedPercent', {
                        percent: formatPercent(used, i18n.language),
                      })}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--surface-sunken)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ background: 'var(--accent)', width: `${Math.min(100, used)}%` }}
                    />
                  </div>
                  <Muted className="mt-0.5">
                    {formatBytes(volume.usedBytes, i18n.language)} /{' '}
                    {formatBytes(volume.sizeBytes, i18n.language)} · {volume.path}
                  </Muted>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {volumesError !== null && (
        <div className="mb-4">
          <ErrorNote message={t(volumesError.i18nKey)} detail={errorDetail(volumesError)} />
        </div>
      )}
    </>
  )
}
