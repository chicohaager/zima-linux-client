import { appError, err, fromUnknown, ok, type Result } from '@shared/result'
import { BASE } from './endpoints'

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

  try {
    const response = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.token === undefined ? {} : { authorization: `Bearer ${opts.token}` }),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    })

    if (response.status === 401) {
      return err(appError('unauthorized', 'token rejected', 'error.unauthorized', context))
    }
    // ZimaOS answers 400 "invalid path" for some directories (a measured
    // regression in the files API). Surfaced as its own kind so the UI can say
    // "the server refuses this path" instead of blaming the client.
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

    const text = await response.text()
    try {
      return ok(JSON.parse(text) as T)
    } catch (cause) {
      return err(
        appError(
          'malformed-response',
          'response was not JSON',
          'error.malformedResponse',
          { ...context, bytes: text.length },
          cause,
        ),
      )
    }
  } catch (cause) {
    return err(fromUnknown(cause, context))
  } finally {
    clearTimeout(timer)
  }
}

/** Reads the gateway route table. Needs no credentials — measured: HTTP 200. */
export const fetchRoutes = (host: string, port = 80): Promise<Result<unknown>> =>
  request<unknown>(host, port, `${BASE.gateway}/routes`, { timeoutMs: 4_000 })
