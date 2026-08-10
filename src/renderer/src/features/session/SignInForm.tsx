import { useState } from 'react'
import type { ConnectionKind } from '@shared/domain'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, SectionTitle } from '../../shared/ui/Card'
import { asAppError, errorMessage } from '../../shared/lib/ipc'
import { Button, ErrorNote, Field } from '../../shared/ui/Controls'

interface Props {
  /** Prefilled when the user picked a discovered device. */
  readonly initialHost?: string
  readonly initialPort?: number
  readonly kind?: ConnectionKind
  readonly displayName?: string | undefined
  readonly onCancel?: (() => void) | undefined
  /**
   * Called after a successful sign-in so the caller can leave the form.
   *
   * Without this the form stayed on screen after a correct password: the session existed,
   * but the screen still rendered the form because nothing cleared its target. Clicking
   * away and back made the overview appear — which reads as "login did nothing".
   * Reported 2026-07-30 from the running app.
   */
  readonly onSignedIn?: (() => void) | undefined
  /**
   * The Remote ID this host was reached through, for `kind: 'remote-id'`.
   *
   * Carried all the way into storage on purpose: without it the saved address is a number
   * inside a tunnel that no longer exists after the app is closed.
   */
  readonly networkId?: string | undefined
}

/**
 * Sign-in form.
 *
 * The error path matters as much as the happy path: ZimaOS answers a wrong password with
 * HTTP 400 and its own code 10013, so the message has to say "wrong password" and not
 * "the server rejects this path". That mapping lives in the main process; here we simply
 * render the i18n key it hands over, plus the technical context underneath.
 */
export const SignInForm = ({
  initialHost = '',
  initialPort = 80,
  kind = 'direct',
  displayName,
  onCancel,
  onSignedIn,
  networkId,
}: Props): React.JSX.Element => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [host, setHost] = useState(initialHost)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const signIn = useMutation({
    mutationFn: async () => {
      const response = await window.zima.signIn({
        host,
        port: initialPort,
        kind,
        username,
        password,
        ...(displayName === undefined ? {} : { displayName }),
        ...(networkId === undefined ? {} : { networkId }),
      })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: async () => {
      // The password never lingers in component state longer than it must.
      setPassword('')
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
      // Leaving the form is part of "signed in". Invalidating the queries alone only
      // refreshes data behind a form that is still covering the screen.
      onSignedIn?.()
    },
  })

  const error = asAppError(signIn.error)
  const canSubmit = host.trim().length > 0 && username.length > 0 && password.length > 0

  return (
    <>
      <SectionTitle>{t('signIn.title')}</SectionTitle>
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) signIn.mutate()
          }}
        >
          <Field
            name="host"
            label={t('signIn.host')}
            value={host}
            onChange={setHost}
            placeholder={t('signIn.hostPlaceholder')}
            autoFocus={initialHost.length === 0}
          />
          <Field
            name="username"
            label={t('signIn.username')}
            value={username}
            onChange={setUsername}
            autoFocus={initialHost.length > 0}
          />
          <Field
            name="password"
            label={t('signIn.password')}
            value={password}
            onChange={setPassword}
            type="password"
          />

          {error !== null && (
            <ErrorNote
              message={errorMessage(t, error)}
              detail={
                error.context === undefined
                  ? undefined
                  : Object.entries(error.context)
                      .map(([key, value]) => `${key}=${String(value)}`)
                      .join('  ')
              }
            />
          )}

          <div className="mt-1 flex gap-2">
            <Button type="submit" disabled={!canSubmit || signIn.isPending}>
              {signIn.isPending ? t('signIn.submitting') : t('signIn.submit')}
            </Button>
            {onCancel !== undefined && (
              <Button variant="secondary" onClick={onCancel}>
                {t('signIn.cancel')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  )
}
