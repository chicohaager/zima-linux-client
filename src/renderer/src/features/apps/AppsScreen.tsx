import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Muted, SectionTitle } from '../../shared/ui/Card'
import { Badge, Button, ErrorNote } from '../../shared/ui/Controls'
import { ExternalIcon, GridIcon, PlayIcon, RefreshIcon, StopIcon } from '../../shared/ui/Icons'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'
import { formatTime } from '../../shared/lib/format'

/**
 * The app grid.
 *
 * Two rules from the plan are visible here:
 *
 *  - **A cached list is dated, never presented as current.** `cachedAtMs` comes from the main
 *    process and turns into "as of 09:14". A cache is a proxy signal: shown as live state it
 *    would report a stopped app as running.
 *  - **Icons come through the media scheme, never as a direct src.** The main process
 *    fetches them without credentials and only accepts real images; the strict img-src CSP
 *    means a direct src could not load them anyway. A tile falls back to the app's initial
 *    only when the metadata names no icon at all.
 */
export const AppsScreen = (): React.JSX.Element => {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()

  const apps = useQuery({
    queryKey: ['apps', 'list'],
    queryFn: async () => unwrap(await window.zima.listApps({})),
    /*
     * Ask again while the tiles on screen are dated — and only then.
     *
     * The main process now answers within 700 ms from its cache instead of waiting out a
     * slow refresh (see `appsHandlers.ts` for the measurement that led there). That fills
     * the screen instantly, but it also means the answer can be older than the device: the
     * refresh it started keeps running and updates the cache when it lands. Without this,
     * "as of 09:14" would sit there until the user navigated away and back.
     *
     * `cachedAtMs === null` means the answer WAS fresh, and then this stops: a healthy
     * device is polled exactly once. The main process shares one in-flight refresh between
     * callers, so this cannot pile requests onto a device that is already slow.
     */
    refetchInterval: (query) =>
      query.state.data?.cachedAtMs === null || query.state.data === undefined ? false : 1_500,
  })

  const setRunning = useMutation({
    mutationFn: async (params: { id: string; running: boolean }) =>
      unwrap(await window.zima.setAppRunning(params)),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['apps'] })
    },
  })

  /*
   * The app window's own pages are written here, not in the main process.
   *
   * That window renders a third-party page, and when it cannot be reached the user has to
   * be told so in their own language — the main process has no catalogues, so the text
   * travels with the request. Interpolated here too, so the main process only escapes it.
   */
  const open = useMutation({
    mutationFn: async (params: { id: string; external: boolean; title: string }) =>
      unwrap(
        await window.zima.openAppWebUi({
          id: params.id,
          external: params.external,
          labels: {
            connecting: t('apps.window.connecting'),
            failedTitle: t('apps.window.failedTitle', { title: params.title }),
            failedBody: t('apps.window.failedBody'),
            reasonLabel: t('apps.window.reasonLabel'),
            hint: t('apps.window.hint'),
          },
        }),
      ),
  })

  // Icons whose URL did not deliver an image. Measured 2026-07-30: two entries in a real
  // app list point at URLs that answer 404, so a broken-image tile is a normal outcome and
  // not an exception. Falling back to the initial keeps the grid tidy without pretending
  // the icon was never named — the reason is in the main-process log (`media.not-served`).
  const [iconFailed, setIconFailed] = useState<ReadonlySet<string>>(new Set())

  const listError = asAppError(apps.error)
  const actionError = asAppError(setRunning.error ?? open.error)
  const locale = i18n.language.replace('-', '_').toLowerCase()

  return (
    <>
      <SectionTitle>{t('apps.title')}</SectionTitle>

      {apps.data?.cachedAtMs !== null && apps.data?.cachedAtMs !== undefined && (
        <Card className="mb-4">
          <div className="flex items-center gap-2">
            <Badge>{t('apps.cached')}</Badge>
            <Muted>
              {t('apps.cachedAt', { time: formatTime(apps.data.cachedAtMs, i18n.language) })}
            </Muted>
            <Button
              variant="secondary"
              className="ml-auto"
              onClick={() => void apps.refetch()}
            >
              <RefreshIcon />
              {t('apps.retry')}
            </Button>
          </div>
        </Card>
      )}

      {listError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, listError)} detail={errorDetail(listError)} />
        </div>
      )}
      {actionError !== null && (
        <div className="mb-4">
          <ErrorNote message={errorMessage(t, actionError)} detail={errorDetail(actionError)} />
        </div>
      )}

      {apps.isPending && (
        <Card>
          <Muted>{t('apps.loading')}</Muted>
        </Card>
      )}

      {apps.data !== undefined && apps.data.apps.length === 0 && (
        <Card>
          <Muted>{t('apps.none')}</Muted>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(apps.data?.apps ?? []).map((app) => {
          const title = app.title[locale] ?? app.title['custom'] ?? app.title['en_us'] ?? app.name
          const running = app.status === 'running'
          return (
            <Card key={app.id}>
              <div className="flex items-start gap-3">
                {app.iconUrl !== null && !iconFailed.has(app.id) ? (
                  <img
                    // Already a `zima-media://appicon/…` URL, built in `ipc/appsHandlers.ts`.
                    // Do not wrap it again — the second encoding decodes to the scheme URL,
                    // whose hostname is the literal "appicon", and the fetch then fails.
                    src={app.iconUrl}
                    alt=""
                    onError={() =>
                      setIconFailed((failed) => new Set(failed).add(app.id))
                    }
                    className="size-11 shrink-0 rounded-xl object-cover"
                    style={{ background: 'var(--surface-sunken)' }}
                  />
                ) : (
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold"
                    style={{ background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}
                  >
                    {title.slice(0, 1).toUpperCase()}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={running ? 'success' : 'neutral'}>
                      {t(`apps.status.${running ? 'running' : 'stopped'}`)}
                    </Badge>
                    {app.port !== null && <Badge>{t('apps.port', { port: app.port })}</Badge>}
                    {app.installStatus !== 'finished' && app.installStatus !== 'unknown' && (
                      <Badge>{app.installStatus}</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {app.webUiUrl !== null ? (
                  <>
                    <Button onClick={() => open.mutate({ id: app.id, external: false, title })}>
                      <GridIcon />
                      {t('apps.openHere')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => open.mutate({ id: app.id, external: true, title })}
                    >
                      <ExternalIcon />
                      {t('apps.openBrowser')}
                    </Button>
                  </>
                ) : (
                  // Stated rather than shown as a dead button: an app without a published
                  // port has no web UI to open.
                  <Muted>{t('apps.noWebUi')}</Muted>
                )}
                <Button
                  variant="secondary"
                  disabled={setRunning.isPending}
                  onClick={() => setRunning.mutate({ id: app.id, running: !running })}
                >
                  {running ? <StopIcon /> : <PlayIcon />}
                  {t(running ? 'apps.stop' : 'apps.start')}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
