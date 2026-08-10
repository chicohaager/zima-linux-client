/**
 * Errors are values, never swallowed.
 *
 * Project rule: no `catch { return [] }`. A failure must carry its cause all the
 * way to the UI, because an empty list that means "it broke" is indistinguishable
 * from an empty list that means "there is nothing" — and that costs hours.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E = AppError> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

/**
 * Reachability is measured, not inferred — and the three failure shapes below are
 * deliberately distinct. "connection refused" (something answered: nothing is
 * listening), "timeout" (nothing answered: a firewall may be dropping) and
 * "unexpected status" (a service answered, but not the one we asked for) lead to
 * different user advice. Collapsing them into "offline" sends people hunting the
 * wrong problem.
 */
export type AppErrorKind =
  | 'refused'
  | 'timeout'
  | 'dns'
  | 'unexpected-status'
  | 'malformed-response'
  | 'unauthorized'
  /** Wrong username or password. ZimaOS answers HTTP 400 for this, not 401. */
  | 'invalid-credentials'
  /** The request body was rejected as malformed by the device (ZimaOS code 400). */
  | 'parameters'
  /** Refused to store a secret because the OS has no keyring and consent is missing. */
  | 'plaintext-risk'
  | 'forbidden-path'
  /** The device says this path does not exist — a normal outcome, e.g. a deleted folder. */
  | 'not-found'
  /**
   * The device answered "no matching operation was found": WE asked for an endpoint it
   * does not implement. Separated from `not-found` because this one is our defect, not the
   * user's situation, and it must be visible instead of reading as "nothing there".
   */
  | 'endpoint-unknown'
  | 'capability-missing'
  | 'cancelled'
  | 'internal'

export interface AppError {
  readonly kind: AppErrorKind
  /** Message for logs — English, technical, never shown raw to the user. */
  readonly message: string
  /** i18n key the UI renders. Keeps user-facing text out of the main process. */
  readonly i18nKey: string
  /** Where the claim came from: host, endpoint, path. Makes a report actionable. */
  readonly context?: Readonly<Record<string, string | number>> | undefined
  readonly cause?: unknown
}

export const appError = (
  kind: AppErrorKind,
  message: string,
  i18nKey: string,
  context?: Readonly<Record<string, string | number>>,
  cause?: unknown,
): AppError => ({ kind, message, i18nKey, context, cause })

/**
 * The one failure that means "not a single stored path answered".
 *
 * 🔴 Shared as a constant, not written twice, because two parts of the program have to agree
 * on it: `session.resume` produces it, and the renderer's path offer is allowed to appear
 * only for it. Measured on 2026-08-10 in a tester's log: the resume failed with HTTP 401 after
 * the path had answered in 8 ms — and the card underneath still claimed "the device answered
 * on no stored path". A wrong sentence in the UI, produced by a condition that was never
 * checked. With the key spelled out on both sides, a rename would have drifted silently;
 * here it breaks the build.
 */
export const NO_PATH_ANSWERED = 'error.noPathAnswered'

/**
 * Digs the OS-level error code out of a thrown value.
 *
 * Necessary because `fetch` wraps transport failures: an ECONNREFUSED arrives as
 * `TypeError: fetch failed` with the real cause one or two levels down in `.cause`.
 * Reading only the top level made a refused connection look like an unexpected HTTP
 * status — caught by the negative control against 127.0.0.1:9.
 */
const errorCode = (value: unknown, depth = 0): string | undefined => {
  if (typeof value !== 'object' || value === null || depth > 4) return undefined
  if ('code' in value) {
    const code = (value as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  if (value instanceof AggregateError) {
    for (const inner of value.errors) {
      const found = errorCode(inner, depth + 1)
      if (found !== undefined) return found
    }
  }
  if ('cause' in value) return errorCode((value as { cause: unknown }).cause, depth + 1)
  return undefined
}

/** Deepest message in the cause chain — fetch hides the real reason down there. */
const rootMessage = (value: unknown, depth = 0): string | undefined => {
  if (typeof value !== 'object' || value === null || depth > 4) return undefined
  const deeper = 'cause' in value ? rootMessage((value as { cause: unknown }).cause, depth + 1) : undefined
  if (deeper !== undefined) return deeper
  return value instanceof Error ? value.message : undefined
}

/** Narrows an unknown thrown value without ever discarding it. */
export const fromUnknown = (cause: unknown, context?: AppError['context']): AppError => {
  const code = errorCode(cause) ?? (cause instanceof Error ? cause.name : undefined)

  // Node's fetch refuses ports on the WHATWG blocked-port list with a bare
  // "bad port" and never opens a socket. That is a bug in our input, not a network
  // condition — reporting it as a transport failure would point at the device.
  if (rootMessage(cause) === 'bad port') {
    return appError('internal', 'port rejected by the runtime (blocked port)', 'error.badPort', context, cause)
  }

  switch (code) {
    case 'ECONNREFUSED':
      return appError('refused', 'connection refused', 'error.refused', context, cause)
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'ABORT_ERR':
    case 'AbortError':
    case 'TimeoutError':
      return appError('timeout', 'connection timed out', 'error.timeout', context, cause)
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return appError('timeout', `network unreachable (${code})`, 'error.timeout', context, cause)
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return appError('dns', 'host not resolvable', 'error.dns', context, cause)
    default:
      return appError(
        'internal',
        cause instanceof Error ? cause.message : String(cause),
        'error.internal',
        context,
        cause,
      )
  }
}
