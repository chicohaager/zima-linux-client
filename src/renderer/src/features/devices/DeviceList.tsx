import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Device } from '@shared/domain'
import { Card, Muted } from '../../shared/ui/Card'
import { Badge, Button } from '../../shared/ui/Controls'

/**
 * Saved devices: switch between them, reorder their connection paths, remove them.
 *
 * "Remove" deletes the registry entry AND the stored session, and says so in the
 * confirmation — a removal that leaves the credential on disk would be a lie.
 */

const addressKey = (a: Device['addresses'][number]): string => `${a.kind}:${a.host}:${a.port}`

export const DeviceList = ({
  onConnect,
}: {
  readonly onConnect: (device: Device) => void
}): React.JSX.Element | null => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const response = await window.zima.listDevices({})
      if (!response.ok) throw response.error
      return response.value
    },
  })

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['devices'] })
    await queryClient.invalidateQueries({ queryKey: ['session'] })
  }

  const activate = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await window.zima.setActiveDevice({ deviceId })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: invalidate,
  })

  const forget = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await window.zima.forgetDevice({ deviceId })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: invalidate,
  })

  const promote = useMutation({
    mutationFn: async ({ device, key }: { device: Device; key: string }) => {
      const rest = device.addresses.map(addressKey).filter((k) => k !== key)
      const response = await window.zima.setAddressPriorities({
        deviceId: device.id,
        orderedAddressKeys: [key, ...rest],
      })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: invalidate,
  })

  if (devices.data === undefined) return null

  const { devices: list, activeDeviceId } = devices.data

  if (list.length === 0) {
    return (
      <Card className="mb-4">
        <p className="font-medium">{t('devices.none')}</p>
        <Muted className="mt-1">{t('devices.noneHint')}</Muted>
      </Card>
    )
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('devices.title')}</h2>
      {list.map((device) => {
        const isActive = device.id === activeDeviceId
        return (
          <Card key={device.id}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{device.displayName}</span>
              {isActive && <Badge tone="success">{t('devices.active')}</Badge>}
              <div className="ml-auto flex gap-2">
                {!isActive && (
                  <Button variant="secondary" onClick={() => activate.mutate(device.id)}>
                    {t('devices.activate')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => onConnect(device)}>
                  {t('devices.connect')}
                </Button>
                <Button
                  variant="danger"
                  title={t('devices.forgetConfirm', { name: device.displayName })}
                  onClick={() => {
                    // Explicit confirmation, naming the device and the consequence.
                    if (window.confirm(t('devices.forgetConfirm', { name: device.displayName }))) {
                      forget.mutate(device.id)
                    }
                  }}
                >
                  {t('devices.forget')}
                </Button>
              </div>
            </div>

            {device.lastSeenIso !== null && (
              <Muted className="mt-1">
                {t('devices.lastSeen', {
                  when: new Date(device.lastSeenIso).toLocaleString(),
                })}
              </Muted>
            )}

            <p className="mt-3 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('devices.addresses')}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {device.addresses.map((address, index) => (
                <li key={addressKey(address)} className="flex items-center gap-2 text-sm">
                  <Badge>{t(`device.connection.${address.kind}`)}</Badge>
                  <span className="font-mono text-xs">
                    {address.host}:{address.port}
                  </span>
                  <span className="ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    #{address.priority}
                  </span>
                  {index > 0 && (
                    <button
                      type="button"
                      title={t('devices.priorityUp')}
                      onClick={() => promote.mutate({ device, key: addressKey(address) })}
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{ background: 'var(--surface-sunken)' }}
                    >
                      ↑<span className="sr-only">{t('devices.priorityUp')}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}
