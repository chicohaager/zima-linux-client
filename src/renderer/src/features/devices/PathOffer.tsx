import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { NO_PATH_ANSWERED, type AppError } from '@shared/result'
import { Card, Muted } from '../../shared/ui/Card'
import { Button } from '../../shared/ui/Controls'
import { WifiIcon } from '../../shared/ui/Icons'

/**
 * Whether this failure is the one the card's sentence talks about.
 *
 * 🔴 The card says "the device answered on no stored path". That is a claim about
 * reachability, and it was shown for EVERY failed resume. Measured 2026-08-10 in a tester's
 * log: `session.resume-path-chosen {"attempts":["<tunnel-address>=19ms"]}` followed by
 * `status:401` in 8 ms — the path answered perfectly, the refresh token had expired, and
 * the card underneath said the opposite while offering a path nobody needed.
 *
 * So the offer is bound to the one error that means what the sentence says, and nothing
 * else. This also spares the LAN scan in every case where it cannot help.
 */
export const offersPaths = (error: AppError): boolean => error.i18nKey === NO_PATH_ANSWERED

/**
 * "Your device did not answer — but there is one standing in your network. Is it this one?"
 *
 * Shown only after a resume failed, because that is the only moment it helps. The situation
 * it exists for, measured 2026-08-10: a stored device with exactly one path, a tunnel that
 * answered 3 of 16 requests, and the same box two milliseconds away in the LAN under an
 * address nobody had stored. Probing cannot fix that and neither can recognition — a device
 * entry written before device codes existed has none, and a missing code deliberately
 * matches nothing.
 *
 * So the last resort is a person. This card asks; it never decides. Two devices in one LAN
 * are common, and adopting the wrong one would point a session — and a token — at somebody
 * else's machine. The main process asks the address for its identity again when the button
 * is pressed, so what gets stored is what is there at that moment, not what a scan reported
 * seconds earlier.
 */
export const PathOffer = ({
  deviceId,
  resumeError,
}: {
  readonly deviceId: string
  readonly resumeError: AppError
}): React.JSX.Element | null => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // Derived once and used as an effect dependency: `resumeError` is a fresh object on
  // every render, so depending on it directly would re-run the LAN scan endlessly.
  const offers = offersPaths(resumeError)
  const [state, setState] = useState<
    | { readonly phase: 'searching' }
    | {
        readonly phase: 'found'
        readonly candidates: readonly { host: string; port: number; deviceName: string | null }[]
        readonly learnedCount: number
      }
    | { readonly phase: 'nothing' }
    | { readonly phase: 'adding'; readonly host: string }
    | { readonly phase: 'added' }
    | { readonly phase: 'failed'; readonly i18nKey: string }
    // Lazy, so a failure the card has nothing to say about never even flashes the
    // "searching …" line on its way to rendering null.
  >(() => (offers ? { phase: 'searching' } : { phase: 'nothing' }))

  useEffect(() => {
    if (!offers) return
    let cancelled = false
    const run = async (): Promise<void> => {
      const found = await window.zima.findDevicePaths({ deviceId })
      if (cancelled) return
      if (!found.ok) {
        setState({ phase: 'failed', i18nKey: found.error.i18nKey })
        return
      }
      const { candidates, learned } = found.value
      setState(
        candidates.length === 0 && learned.length === 0
          ? { phase: 'nothing' }
          : {
              phase: 'found',
              candidates: candidates.map((c) => ({
                host: c.host,
                port: c.port,
                deviceName: c.deviceName,
              })),
              learnedCount: learned.length,
            },
      )
    }
    void run()
    return (): void => {
      cancelled = true
    }
  }, [deviceId, offers])

  const adopt = async (host: string, port: number): Promise<void> => {
    setState({ phase: 'adding', host })
    const added = await window.zima.addDevicePath({ deviceId, host, port })
    if (!added.ok) {
      setState({ phase: 'failed', i18nKey: added.error.i18nKey })
      return
    }
    // The device list carries the new path; the session screen should try again with it.
    await queryClient.invalidateQueries({ queryKey: ['devices'] })
    setState({ phase: 'added' })
  }

  // Nothing to offer is not a message. A card saying "found nothing" next to an error the
  // user is already reading adds noise, not information.
  if (state.phase === 'nothing') return null

  if (state.phase === 'searching') {
    return (
      <Card className="mb-4">
        <Muted>{t('device.pathOffer.searching')}</Muted>
      </Card>
    )
  }

  if (state.phase === 'failed') {
    return (
      <Card className="mb-4">
        <Muted>{t(state.i18nKey)}</Muted>
      </Card>
    )
  }

  if (state.phase === 'added') {
    return (
      <Card className="mb-4">
        <p className="font-medium">{t('device.pathOffer.added')}</p>
        <Muted>{t('device.pathOffer.addedHint')}</Muted>
      </Card>
    )
  }

  return (
    <Card className="mb-4">
      <p className="font-medium">{t('device.pathOffer.title')}</p>
      <Muted>{t('device.pathOffer.explain')}</Muted>

      {state.phase === 'found' && state.learnedCount > 0 && (
        <Muted>{t('device.pathOffer.learned', { count: state.learnedCount })}</Muted>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {state.phase === 'found' &&
          state.candidates.map((candidate) => (
            <div
              key={`${candidate.host}:${candidate.port}`}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <WifiIcon />
                <span className="font-mono text-sm">
                  {candidate.host}:{candidate.port}
                </span>
                {candidate.deviceName !== null && <Muted>{candidate.deviceName}</Muted>}
              </span>
              <Button onClick={() => void adopt(candidate.host, candidate.port)}>
                {t('device.pathOffer.add')}
              </Button>
            </div>
          ))}
        {state.phase === 'adding' && <Muted>{t('device.pathOffer.adding', { host: state.host })}</Muted>}
      </div>
    </Card>
  )
}
