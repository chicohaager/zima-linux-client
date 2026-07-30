import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, SectionTitle } from '../../shared/ui/Card'
import { Button, ErrorNote, Field } from '../../shared/ui/Controls'

interface Props {
  /** Prefilled when the user picked a discovered device. */
  readonly initialHost?: string
  readonly initialPort?: number
  readonly kind?: 'lan' | 'direct'
  readonly displayName?: string | undefined
  readonly onCancel?: (() => void) | undefined
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
      })
      if (!response.ok) throw response.error
      return response.value
    },
    onSuccess: async () => {
      // The password never lingers in component state longer than it must.
      setPassword('')
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
  })

  const error = signIn.error as { i18nKey?: string; context?: Record<string, unknown> } | null
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
              message={t(error.i18nKey ?? 'error.internal')}
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
