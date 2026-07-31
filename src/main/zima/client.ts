import { appError, err, fromUnknown, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import { BASE } from './endpoints'
import { envelopeIsOk, envelopeToError, isEnvelope, unwrap } from './envelope'

/**
 * Thin HTTP client for the ZimaOS gateway.
 *
 * Deliberately narrow: it only knows how to reach the gateway (port 80/443 on the
 * device), never a backend service port. ZimaOS hands service ports out from the
 * ephemeral range and they move on restart, so a hardcoded port produces a
 * "connection refused" that looks like an outage while the service is fine.
 */

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly token?: string
  readonly timeoutMs?: number
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>
}

/**
 * Everything needed to talk to the active device: where it is, and proof of who we are.
 *
 * Passed explicitly rather than read from a module-level "current device", so a service
 * function can never accidentally act on a device the caller did not mean — the class of
 * bug where switching devices leaves one request pointing at the old one.
 */
export interface DeviceContext {
  readonly host: string
  readonly port: number
  readonly token: string
}

const DEFAULT_TIMEOUT_MS = 8_000

export const baseUrl = (host: string, port = 80): string => {
  const scheme = port === 443 ? 'https' : 'http'
  const authority = port === 80 || port === 443 ? host : `${host}:${port}`
  return `${scheme}://${authority}`
}

const buildUrl = (
  host: string,
  port: number,
  path: string,
  query: RequestOptions['query'],
): string => {
  const url = new URL(`${baseUrl(host, port)}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/**
 * Performs one request and maps every outcome to a Result.
 *
 * Nothing is swallowed: a non-2xx answer, a body we cannot parse and a transport
 * failure are three distinct errors, each carrying the host and path so a report
 * says which door was tried.
 */
export const request = async <T>(
  host: string,
  port: number,
  path: string,
  opts: RequestOptions = {},
): Promise<Result<T>> => {
  const url = buildUrl(host, port, path, opts.query)
  const context = { host, path, method: opts.method ?? 'GET' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  /*
   * 🔴 Every request is timed, and slow or failing ones are named in the log.
   *
   * Added 2026-07-30 after a report of "it says loading for a very long time". Nothing in
   * this client could say WHICH request was slow — the round trip to the device measured
   * 3–16 ms over the tunnel and 1–2 ms over the LAN, so the delay was ours, and there was
   * no instrument to point at it. Guessing which call it was would have been exactly the
   * substitute-signal mistake this project keeps paying for.
   *
   * Successful fast requests stay silent: a log that records everything records nothing.
   */
  const startedAt = performance.now()
  const elapsed = (): number => Math.round(performance.now() - startedAt)

  try {
    const response = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        /**
         * The BARE token, no `Bearer ` prefix.
         *
         * Measured 2026-07-30 against a v1.7.0 host on `GET /v2/zimaos/zt/info`:
         *   Authorization: <jwt>          -> 200 (or 500 from the service behind it)
         *   Authorization: Bearer <jwt>   -> 401 {"message":"invalid or expired jwt"}
         *   Authorization: bearer <jwt>   -> 401 (same)
         *
         * The `Bearer` form was an assumption carried over from habit — it is what almost
         * every other API wants, and it was never measured here. Nothing had caught it
         * because the client had not made a single authenticated request yet.
         *
         * ⚠️ The witness matters: `/v2/zimaos/device/info` answers 200 for every variant
         * INCLUDING no header at all, so it cannot decide this question. An endpoint that
         * does not enforce auth is useless as proof about auth.
         */
        ...(opts.token === undefined ? {} : { authorization: opts.token }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    })

    const text = await response.text()
    // Slow OR unsuccessful — both are worth a line, and neither was visible before. The
    // byte count is here because a fast request for a 1.5 MB body and a slow request for a
    // small one need different fixes.
    if (elapsed() > 1_000 || !response.ok) {
      logger.warn('zima.request', { ...context, status: response.status, ms: elapsed(), bytes: text.length })
    }
    let body: unknown = undefined
    let parseFailed = false
    if (text.length > 0) {
      try {
        body = JSON.parse(text)
      } catch {
        parseFailed = true
      }
    }

    // The body decides before the status does. ZimaOS overloads HTTP 400: on the files
    // API it means "invalid path", on login it means "wrong password" (measured:
    // {"success":10013,…} with HTTP 400). Reading only the status produced the wrong
    // message for one of the two.
    if (isEnvelope(body) && !envelopeIsOk(body)) {
      return err(envelopeToError(body, response.status, context))
    }

    if (response.status === 401) {
      return err(appError('unauthorized', 'token rejected', 'error.unauthorized', context))
    }
    /**
     * 404 is two different statements on this API, and the body is what tells them apart.
     * Measured 2026-07-30 with a valid token:
     *
     *   GET /v2_1/files/file?path=<missing>   -> 404 {"message":"path not exist"}
     *   GET /v2/zimaos/sys/hardware           -> 404 {"message":"no matching operation was found"}
     *
     * The first is a normal, user-caused outcome ("that folder is gone"); the second means
     * this client is asking for a path the device does not implement, which is a defect on
     * our side. Rendering both as "not found" would let a wrong endpoint hide for months
     * behind a plausible message — the second one is how three wrong paths in this client
     * were caught.
     */
    if (response.status === 404) {
      const message = typeof (body as { message?: unknown } | null)?.message === 'string'
        ? (body as { message: string }).message
        : ''
      if (message.includes('no matching operation')) {
        return err(
          appError('endpoint-unknown', `device does not implement ${path}`, 'error.endpointUnknown', {
            ...context,
            status: 404,
          }),
        )
      }
      return err(
        appError('not-found', message.length > 0 ? message : 'not found', 'error.notFound', {
          ...context,
          status: 404,
        }),
      )
    }

    // No envelope and a bare 400: this is the files API's "invalid path" case, kept as
    // its own kind so the UI can say the server refuses the path instead of blaming
    // the user's input.
    if (response.status === 400) {
      return err(
        appError('forbidden-path', 'server rejected the path', 'error.forbiddenPath', {
          ...context,
          status: 400,
        }),
      )
    }
    if (!response.ok) {
      return err(
        appError('unexpected-status', `HTTP ${response.status}`, 'error.unexpectedStatus', {
          ...context,
          status: response.status,
        }),
      )
    }
    if (parseFailed) {
      return err(
        appError('malformed-response', 'response was not JSON', 'error.malformedResponse', {
          ...context,
          bytes: text.length,
        }),
      )
    }

    // Unwrap the envelope so callers always see the payload, never the wrapper.
    return ok(unwrap(body) as T)
  } catch (cause) {
    // A timeout costs the full 8 s and then react-query tries again — the single most
    // expensive thing that can happen behind a "loading" label, and until now it left no
    // trace at all.
    logger.warn('zima.request-failed', {
      ...context,
      ms: elapsed(),
      reason: (cause instanceof Error ? cause.message : String(cause)).slice(0, 200),
    })
    return err(fromUnknown(cause, context))
  } finally {
    clearTimeout(timer)
  }
}

/** Reads the gateway route table. Needs no credentials — measured: HTTP 200. */
export const fetchRoutes = (host: string, port = 80): Promise<Result<unknown>> =>
  request<unknown>(host, port, `${BASE.gateway}/routes`, { timeoutMs: 4_000 })

/** An authenticated request against the device in `ctx`. */
export const authed = <T>(
  ctx: DeviceContext,
  path: string,
  opts: Omit<RequestOptions, 'token'> = {},
): Promise<Result<T>> => request<T>(ctx.host, ctx.port, path, { ...opts, token: ctx.token })

/**
 * Fetches a binary resource (thumbnail, download) and hands back bytes plus content type.
 *
 * Separate from `request` because that one parses JSON and would turn a JPEG into a
 * `malformed-response`. Used by the media protocol handler, so the renderer can show
 * images without ever holding a token.
 */
export const fetchBinary = async (
  ctx: DeviceContext,
  path: string,
  query: RequestOptions['query'] = {},
  timeoutMs = 20_000,
): Promise<Result<{ bytes: Uint8Array; contentType: string }>> => {
  const url = buildUrl(ctx.host, ctx.port, path, query)
  const context = { host: ctx.host, path, method: 'GET' }
  try {
    const response = await fetch(url, {
      headers: { authorization: ctx.token },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      return err(
        appError('unexpected-status', `HTTP ${response.status}`, 'error.unexpectedStatus', {
          ...context,
          status: response.status,
        }),
      )
    }
    const buffer = await response.arrayBuffer()
    return ok({
      bytes: new Uint8Array(buffer),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    })
  } catch (cause) {
    return err(fromUnknown(cause, context))
  }
}
