import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Button, ErrorNote } from '../../shared/ui/Controls'
import { PowerIcon, RefreshIcon } from '../../shared/ui/Icons'
import { asAppError, errorDetail, unwrap } from '../../shared/lib/ipc'

/**
 * Restart and power off.
 *
 * The confirmation repeats the DEVICE NAME, as the plan requires: with several devices in the
 * registry, "are you sure?" is not enough information to answer safely. The second click is
 * the only place `confirmed: true` is set, so the main process can require it.
 *
 * A timeout is NOT treated as success. A device that is shutting down may never answer, and
 * reporting "done" because nothing came back would be a guess dressed as a result — so the
 * error is shown with its kind, and the wording says the confirmation is missing rather than
 * that the action failed.
 */
export const PowerActions = ({
  deviceId,
  deviceName,
}: {
  readonly deviceId: string
  readonly deviceName: string
}): React.JSX.Element => {
  const { t } = useTranslation()
  const [pending, setPending] = useState<'restart' | 'off' | null>(null)

  const power = useMutation({
    mutationFn: async (action: 'restart' | 'off') =>
      unwrap(await window.zima.powerDevice({ deviceId, action, confirmed: true })),
    onSettled: () => setPending(null),
  })

  const error = asAppError(power.error)

  return (
    <Card className="mb-4">
      <p className="mb-2 text-sm font-medium">{t('power.title')}</p>

      {pending === null ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPending('restart')}>
            <RefreshIcon />
            {t('power.restart')}
          </Button>
          <Button variant="danger" onClick={() => setPending('off')}>
            <PowerIcon />
            {t('power.off')}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm font-medium">
            {t(pending === 'restart' ? 'power.confirmRestart' : 'power.confirmOff', {
              name: deviceName,
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={power.isPending}
              onClick={() => power.mutate(pending)}
            >
              {t('power.yes')}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('power.no')}
            </Button>
          </div>
        </>
      )}

      {power.data !== undefined && (
        <Muted className="mt-2">
          {t(power.data.requested === 'restart' ? 'power.restarting' : 'power.shuttingDown')}
        </Muted>
      )}

      {error !== null && (
        <div className="mt-2">
          <ErrorNote
            message={`${t('power.noConfirmation')} ${t(error.i18nKey)}`}
            detail={errorDetail(error)}
          />
        </div>
      )}
    </Card>
  )
}
