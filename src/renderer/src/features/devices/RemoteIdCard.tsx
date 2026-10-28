import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Card, Muted } from '../../shared/ui/Card'
import { Button, ErrorNote, Field } from '../../shared/ui/Controls'
import { asAppError, errorDetail, errorMessage, unwrap } from '../../shared/lib/ipc'
import type { SignInTarget } from './signInTarget'

/** What the user typed into the card — owned by the parent, see below. */
export interface RemoteIdInput {
  readonly remoteId: string
  // Text, not number: an empty or half-typed field must stay representable. Validated on submit.
  readonly remotePort: string
}

export const EMPTY_REMOTE_ID_INPUT: RemoteIdInput = { remoteId: '', remotePort: '80' }

/**
 * The Remote ID card of the device screen: ID and port in, a sign-in target out.
 *
 * 🔴 The typed values are the PARENT's state, not the card's. With its own state the card
 * lost them whenever DeviceScreen swapped itself for the sign-in form (shipped in 2.0.4:
 * type an ID, take the IP-address path, come back — empty). DeviceScreen stays mounted across
 * that swap, so state held there survives it, as it did before the split.
 */
export const RemoteIdCard = ({
  input,
  onInput,
  onConnected,
}: {
  readonly input: RemoteIdInput
  readonly onInput: (next: RemoteIdInput) => void
  readonly onConnected: (target: SignInTarget) => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const { remoteId, remotePort } = input
  const setRemoteId = (value: string): void => onInput({ ...input, remoteId: value })
  const setRemotePort = (value: string): void => onInput({ ...input, remotePort: value })
  const remotePortNumber = /^\d{1,5}$/.test(remotePort.trim()) ? Number(remotePort.trim()) : NaN
  const remotePortValid = Number.isInteger(remotePortNumber) && remotePortNumber >= 1 && remotePortNumber <= 65535
  const remoteIdValid = /^[0-9a-fA-F]{16}$/.test(remoteId.trim())

  // Remote ID: one step for the user — type the ID, then sign in. The join, the address
  // derivation and the probe all happen behind this single mutation, because none of them
  // is a decision the user makes.
  const remote = useMutation({
    mutationFn: async (input: { id: string; port: number }) =>
      unwrap(await window.zima.connectRemoteId({ remoteId: input.id, port: input.port })),
    onSuccess: (result) => {
      onInput(EMPTY_REMOTE_ID_INPUT)
      onConnected({
        host: result.host,
        port: result.port,
        kind: 'remote-id',
        // The ID the user typed IS the ZeroTier network. Kept so it reaches storage — the
        // derived 10.x.y.1 is worthless on the next start without it.
        networkId: remoteId.trim().toLowerCase(),
        // Spread rather than an `undefined` value: exactOptionalPropertyTypes draws a line
        // between "absent" and "present but undefined", and this side of it is absent.
        ...(result.networkName.length > 0 ? { displayName: result.networkName } : {}),
      })
    },
  })
  const remoteError = asAppError(remote.error)

  // Offered only when the failure is the missing capability — a button that appears for
  // every error would invite people to grant privileges against unrelated problems.
  const [copied, setCopied] = useState(false)
  // Installs this app's own copy and reports what is still missing. It does NOT grant the
  // capability — see provision.ts for why that is neither possible from here nor desirable.
  const provision = useMutation({
    mutationFn: async () => unwrap(await window.zima.zerotierProvision({})),
    onSuccess: () => setCopied(false),
  })
  const provisionError = asAppError(provision.error)
  const needsCapability =
    remoteError !== null && remoteError.kind === 'capability-missing' &&
    remoteError.message.includes('virtual network device')

  return (
    <Card className="mb-4">
      <p className="font-medium">{t('device.remoteIdTitle')}</p>
      <Muted className="mt-1">{t('device.remoteIdHint')}</Muted>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (remoteIdValid && remotePortValid) {
            remote.mutate({ id: remoteId.trim(), port: remotePortNumber })
          }
        }}
      >
        <div className="min-w-56 flex-1">
          <Field
            name="remoteId"
            label={t('device.remoteIdLabel')}
            value={remoteId}
            onChange={setRemoteId}
            placeholder="0123456789abcdef"
          />
        </div>
        <div className="w-28">
          <Field
            name="remotePort"
            label={t('device.remoteIdPortLabel')}
            value={remotePort}
            onChange={setRemotePort}
            placeholder="80"
          />
        </div>
        <Button
          type="submit"
          disabled={remote.isPending || !remoteIdValid || !remotePortValid}
        >
          {remote.isPending ? t('device.remoteIdConnecting') : t('device.connect')}
        </Button>
      </form>
      {/* A fresh identity waits ~5 s for the device's network to admit it (measured
          2026-10-28); "Connecting…" alone for that long reads as a hang. Scrolled into view on
          mount: in a 1180×783 window the card sits at the bottom and the line landed below the
          fold. Optional call — jsdom has no scrollIntoView. */}
      {remote.isPending && (
        <div ref={(el) => el?.scrollIntoView?.({ block: 'nearest' })}>
          <Muted className="mt-2">{t('device.remoteIdWaiting')}</Muted>
        </div>
      )}
      {remoteError !== null && (
        <div className="mt-3">
          <ErrorNote
            message={errorMessage(t, remoteError)}
            detail={errorDetail(remoteError)}
          />
        </div>
      )}
      {needsCapability && (
        <div className="mt-3">
          <Muted className="mb-2">{t('zerotier.provisionHint')}</Muted>
          {provision.data === undefined ? (
            <Button onClick={() => provision.mutate()} disabled={provision.isPending}>
              {provision.isPending ? t('zerotier.provisioning') : t('zerotier.provision')}
            </Button>
          ) : provision.data.capable === true ? (
            <>
              <Muted className="mb-2">{t('zerotier.capable')}</Muted>
              <Button onClick={() => remote.mutate({ id: remoteId.trim(), port: remotePortValid ? remotePortNumber : 80 })}>
                {t('zerotier.recheck')}
              </Button>
            </>
          ) : (
            <>
              {/* The command is shown, not run. This app cannot execute it — its own
                  process tree has no_new_privs set, so the kernel ignores the setuid bit
                  on pkexec/sudo for anything it launches — and it should not want to:
                  an application that raises its own password dialog teaches people to
                  type their password at whatever asks. */}
              <Muted className="mb-2">{t('zerotier.commandHint')}</Muted>
              <code className="mb-2 block overflow-x-auto rounded bg-black/5 p-2 font-mono text-xs select-all dark:bg-white/10">
                {provision.data.command}
              </code>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(provision.data.command)
                    setCopied(true)
                  }}
                >
                  {copied ? t('zerotier.copied') : t('zerotier.copy')}
                </Button>
                <Button onClick={() => remote.mutate({ id: remoteId.trim(), port: remotePortValid ? remotePortNumber : 80 })} disabled={remote.isPending}>
                  {t('zerotier.recheck')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {provisionError !== null && (
        <div className="mt-3">
          <ErrorNote
            message={errorMessage(t, provisionError)}
            detail={errorDetail(provisionError)}
          />
        </div>
      )}
    </Card>
  )
}
