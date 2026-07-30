import { useTranslation } from 'react-i18next'
import type { Capabilities } from '@shared/domain'
import { Card, Muted } from '../../shared/ui/Card'

/**
 * Shows what this specific device offers.
 *
 * Worth being explicit about: ZimaOS modules are optional. Two hosts on the same
 * v1.7.0 build were measured with 35 and 38 gateway routes, and `/v2/photos` existed
 * on only one of them. So this list is derived from the device's own route table, and
 * an absent feature is spelled out rather than hidden.
 */

const ORDER = [
  'photoBrowse',
  'photoBackup',
  'photoLibrary',
  'files',
  'apps',
  'appStore',
  'systemPower',
  'zerotier',
  'backup',
] as const satisfies readonly (keyof Capabilities)[]

interface Props {
  readonly capabilities: Capabilities
}

export const CapabilityList = ({ capabilities }: Props): React.JSX.Element => {
  const { t } = useTranslation()

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium">{t('device.capabilities')}</h3>
        <Muted>{t('device.routes', { count: capabilities.routes.length })}</Muted>
      </div>

      <ul className="flex flex-col gap-2">
        {ORDER.map((key) => {
          const present = capabilities[key] === true
          return (
            <li key={key} className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: present ? 'var(--success)' : 'var(--text-muted)' }}
              />
              <span>{t(`capability.${key}`)}</span>
              <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>
                {present ? t('capability.present') : t('capability.absent')}
              </span>
            </li>
          )
        })}
      </ul>

      {!capabilities.photoLibrary && (
        <div
          className="mt-4 rounded-xl p-3 text-sm"
          style={{ background: 'var(--warning-soft)' }}
        >
          <p className="font-medium">{t('photos.libraryMissing')}</p>
          <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('photos.libraryMissingHint')}
          </p>
        </div>
      )}
    </Card>
  )
}
