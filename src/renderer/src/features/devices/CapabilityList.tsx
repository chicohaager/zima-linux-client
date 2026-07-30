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

/**
 * Only the plainly boolean rows. ZeroTier is rendered separately below because it has
 * four distinct answers — a green dot for "route exists" was exactly the false green this
 * list is supposed to prevent.
 */
const ORDER = [
  'photoBrowse',
  'photoBackup',
  'photoLibrary',
  'files',
  'apps',
  'appStore',
  'systemPower',
  'backup',
] as const satisfies readonly (keyof Capabilities)[]

/** Maps the measured state to a dot colour and a phrase — no state falls through. */
const zerotierLook = (
  state: Capabilities['zerotier'],
): { readonly tone: string; readonly key: string; readonly detail: string | null } => {
  if (state === 'unknown') return { tone: 'var(--text-muted)', key: 'capability.ztUnknown', detail: null }
  switch (state.kind) {
    case 'online':
      return {
        tone: 'var(--success)',
        key: 'capability.ztOnline',
        detail: state.networkName,
      }
    case 'offline':
      return { tone: 'var(--warning)', key: 'capability.ztOffline', detail: state.networkName }
    case 'not-running':
      return { tone: 'var(--warning)', key: 'capability.ztNotRunning', detail: null }
    case 'absent':
      return { tone: 'var(--text-muted)', key: 'capability.absent', detail: null }
    case 'unreachable':
      return { tone: 'var(--text-muted)', key: 'capability.ztUnreachable', detail: null }
  }
}

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

        {/* ZeroTier: the measured state, with the network name when the device gave one.
            Never a bare green dot — that was the false green this list exists to avoid. */}
        {(() => {
          const look = zerotierLook(capabilities.zerotier)
          return (
            <li className="flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: look.tone }}
              />
              <span>{t('capability.zerotier')}</span>
              <span className="ml-auto text-right" style={{ color: 'var(--text-muted)' }}>
                {t(look.key)}
                {look.detail !== null && ` · ${look.detail}`}
              </span>
            </li>
          )
        })()}
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
