import type { AppError } from '@shared/result'

/**
 * Bridging the IPC envelope to the way react-query wants to be told about failure.
 *
 * Every channel answers `{ok:true,value} | {ok:false,error}`. A hook that ignored the
 * failure branch would hand `undefined` to a component, which renders as an empty screen —
 * the exact ambiguity the envelope exists to remove. So `unwrap` throws the `AppError`, and
 * react-query puts it in `error`, where a component has to deal with it to show anything.
 */

export const unwrap = <T>(response: { ok: true; value: T } | { ok: false; error: AppError }): T => {
  if (response.ok) return response.value
  throw response.error
}

/** Narrows an unknown react-query error back to an AppError when it is one. */
export const asAppError = (error: unknown): AppError | null =>
  typeof error === 'object' && error !== null && 'kind' in error && 'i18nKey' in error
    ? (error as AppError)
    : null

/** `host=… path=…` — the technical origin shown under a translated message. */
/**
 * The technical line under a translated error message.
 *
 * 🔴 This used to show only `context`, so a failed Remote-ID connection rendered as
 * "kind=remote-id" — the label of the route that failed, and nothing about why. The actual
 * reason lives in `message` (here: the ZeroTier daemon exiting immediately), and it was
 * being dropped at the last step before the screen. A detail line that omits the diagnosis
 * is decoration.
 *
 * `message` is deliberately technical and untranslated: it is for reading out or pasting
 * into a report, while the sentence above it is the one written for the user.
 */
export const errorDetail = (error: AppError | null): string | undefined => {
  if (error === null) return undefined
  const context = Object.entries(error.context ?? {}).map(([key, value]) => `${key}=${String(value)}`)
  const parts = [error.message, ...context].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join('  ·  ') : undefined
}
