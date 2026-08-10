import type { TFunction } from 'i18next'
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

/**
 * The translated sentence for an error — **with its values filled in**.
 *
 * 🔴 Every one of the ~20 call sites used to write `t(error.i18nKey)` and nothing else. Two
 * catalogue entries carry placeholders — `error.noPathAnswered` ("… ({{paths}})") and
 * `error.unexpectedStatus` ("… (HTTP {{status}})") — and both rendered the placeholder
 * verbatim. Seen on a real desktop on 2026-08-10 in the shipped 2.0.0-alpha.2:
 *
 *     Kein gespeicherter Verbindungsweg hat geantwortet ({{paths}}).
 *
 * The values were never missing: they sit in `error.context`, and the line underneath was
 * printing them the whole time. They simply were not handed to the translator.
 *
 * `replace` rather than spreading the context into the options object: i18next treats
 * `count`, `context`, `lng`, `ns` and friends as its own options, so a context field with
 * one of those names would change the lookup instead of filling a hole — a bug that would
 * surface in one language and not the next.
 *
 * A missing placeholder value stays visible on purpose. i18next leaves `{{x}}` standing when
 * nothing is supplied, and that is the honest outcome: a hole shows there is a hole, while a
 * silent blank would read as a finished sentence.
 */
export const errorMessage = (
  t: TFunction,
  error: AppError | null,
  fallbackKey = 'error.internal',
): string => t(error?.i18nKey ?? fallbackKey, { replace: error?.context ?? {} })
