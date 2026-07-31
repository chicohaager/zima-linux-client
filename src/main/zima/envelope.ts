import { appError, type AppError, type AppErrorKind } from '@shared/result'

/**
 * ZimaOS wraps some answers in its own envelope and carries an application code that
 * does NOT line up with the HTTP status. Measured 2026-07-30 against a live v1.7.0
 * host:
 *
 *   POST /v1/users/login  wrong password  -> HTTP 400
 *       {"success":10013,"message":"User does not exist or password is invalid"}
 *   POST /v1/users/login  empty body      -> HTTP 400
 *       {"success":400,"message":"Parameters Error"}
 *   POST /v1/users/refresh no token       -> HTTP 401
 *       {"success":20006,"message":"Verification failure","data":"token contains …"}
 *   GET  /v1/users/status                 -> HTTP 200
 *       {"success":200,"message":"ok","data":{…}}
 *   GET  /v2/zimaos/sys/hardware no token -> HTTP 401  {"message":"invalid or expired jwt"}
 *   GET  /v2_1/files/file        no token -> HTTP 401  {"message":"Unauthorized"}
 *
 * So HTTP 400 is overloaded: on the files API it means "invalid path", on login it
 * means "wrong password". Mapping 400 to a single meaning produced exactly the wrong
 * user-facing message, which is why this module exists — the application code decides,
 * and the HTTP status is only the fallback.
 */

export interface ZimaEnvelope {
  readonly success: number
  readonly message: string
  readonly data: unknown
}

/** True when the body carries ZimaOS's own envelope rather than a bare payload. */
export const isEnvelope = (body: unknown): body is ZimaEnvelope =>
  typeof body === 'object' &&
  body !== null &&
  'success' in body &&
  typeof (body as { success: unknown }).success === 'number'

/**
 * Application codes observed on a live device. Only codes actually measured are
 * listed; anything else falls through to the HTTP status rather than being guessed at.
 */
const CODE_MAP: Readonly<Record<number, { kind: AppErrorKind; i18nKey: string }>> = {
  10013: { kind: 'invalid-credentials', i18nKey: 'error.invalidCredentials' },
  400: { kind: 'parameters', i18nKey: 'error.parameters' },
  20006: { kind: 'unauthorized', i18nKey: 'error.unauthorized' },
}

/** An envelope is a success only when its own code says so — not because HTTP said 200. */
export const envelopeIsOk = (envelope: ZimaEnvelope): boolean =>
  envelope.success >= 200 && envelope.success < 300

/**
 * Turns a failing envelope into a typed error. `message` is kept for the log but never
 * shown raw: the UI renders the i18n key so a German user does not get English text.
 */
export const envelopeToError = (
  envelope: ZimaEnvelope,
  httpStatus: number,
  context: Readonly<Record<string, string | number>>,
): AppError => {
  const mapped = CODE_MAP[envelope.success]
  if (mapped !== undefined) {
    return appError(mapped.kind, `${envelope.success}: ${envelope.message}`, mapped.i18nKey, {
      ...context,
      code: envelope.success,
      status: httpStatus,
    })
  }

  return appError(
    httpStatus === 401 ? 'unauthorized' : 'unexpected-status',
    `unmapped ZimaOS code ${envelope.success}: ${envelope.message}`,
    httpStatus === 401 ? 'error.unauthorized' : 'error.unexpectedStatus',
    { ...context, code: envelope.success, status: httpStatus },
  )
}

/**
 * The only keys an envelope is allowed to carry. Anything else means the object IS the
 * payload — see `isWrapped`.
 */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['success', 'message', 'data'])

/**
 * True when the body is a wrapper around `data` rather than the payload itself.
 *
 * 🔴 Measured 2026-07-30 against a live v1.7.0 host, because assuming this cost three
 * broken screens. ZimaOS uses THREE answer families, and only the first carries `success`:
 *
 *   `{success,message,data}`  /v1/sys/utilization, /v1/users/current, /v1/sys/hardware
 *   `{data,message}`          /v2_1/files/tasks, /v2/app_management/web/appgrid
 *   `{data}`                  /v2_1/files/trash, /v2_1/files/trash/stats,
 *                             /v2_1/files/file/search, /v2/app_management/installed/list
 *   bare payload              /v2_1/files/file, /v2/photos/*, /v2/zimaos/device/info,
 *                             /v2_1/files/pin (a raw array), /v2/local_storage/storages
 *
 * `isEnvelope` above tests for `success` because the application CODE lives there — that
 * is the error path and it is v1-only. Unwrapping is a different question, and tying it to
 * `success` meant every v2 listing arrived at its parser still wrapped: "expected array,
 * received object" on Apps, Trash and the task list, while the wire probes reported a
 * clean 200 with a correct shape. Same failure as the refresh-token parser: an unmeasured
 * sibling inherited a measured one's assumption.
 *
 * The test is deliberately NARROW — `data` present AND every key drawn from
 * `ENVELOPE_KEYS`. A mere `'data' in body` would swallow any payload that happens to own
 * a `data` field. Verified against all 21 measured 200-answers: no bare payload has a
 * top-level `data`, and no envelope carries a key outside this set.
 */
const isWrapped = (body: unknown): body is { readonly data: unknown } =>
  typeof body === 'object' &&
  body !== null &&
  !Array.isArray(body) &&
  'data' in body &&
  Object.keys(body).every((key) => ENVELOPE_KEYS.has(key))

/** Unwraps `data` when an envelope is present, otherwise returns the body unchanged. */
export const unwrap = (body: unknown): unknown => (isWrapped(body) ? body.data : body)
