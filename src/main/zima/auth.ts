import { appError, err, isErr, ok, type Result } from '@shared/result'
import { BASE, USERS } from './endpoints'
import { request } from './client'
import { decodeClaims, needsRenewal, requireKind, type TokenClaims } from './jwt'

/**
 * Login and token renewal.
 *
 * The response shape is measured, not assumed: `POST /v1/users/login` answers
 * `{"success":200,…,"data":{"token":{"access_token":…,"refresh_token":…}}}`, and the
 * client unwraps the envelope, so what arrives here is the `data` object.
 *
 * Renewal is single-flight. Without that, several parallel requests noticing an expired
 * token would each start their own refresh; ZimaOS rotates the refresh token, so the
 * later ones would race and one would lose its credential.
 */

export interface Tokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly access: TokenClaims
  readonly refresh: TokenClaims
}

interface LoginPayload {
  readonly token?: { readonly access_token?: unknown; readonly refresh_token?: unknown }
}

const readTokenPair = (payload: unknown): Result<{ access: string; refresh: string }> => {
  const token = (payload as LoginPayload | null)?.token
  const access = token?.access_token
  const refresh = token?.refresh_token

  if (typeof access !== 'string' || typeof refresh !== 'string') {
    // A shape we do not recognise is an error, never an empty session. An empty
    // session would silently look like "not signed in" and hide a protocol change.
    return err(
      appError(
        'malformed-response',
        'login response did not contain data.token.access_token/refresh_token',
        'error.malformedResponse',
      ),
    )
  }
  return ok({ access, refresh })
}

const buildTokens = (access: string, refresh: string): Result<Tokens> => {
  const accessClaims = decodeClaims(access)
  if (isErr(accessClaims)) return accessClaims
  const refreshClaims = decodeClaims(refresh)
  if (isErr(refreshClaims)) return refreshClaims

  // Pin the issuers: a server that hands back two access tokens, or swaps them, must
  // not silently produce a session that cannot be renewed.
  const asAccess = requireKind(accessClaims.value, 'access')
  if (isErr(asAccess)) return asAccess
  const asRefresh = requireKind(refreshClaims.value, 'refresh')
  if (isErr(asRefresh)) return asRefresh

  return ok({
    accessToken: access,
    refreshToken: refresh,
    access: asAccess.value,
    refresh: asRefresh.value,
  })
}

export const login = async (
  host: string,
  port: number,
  username: string,
  password: string,
): Promise<Result<Tokens>> => {
  const response = await request<unknown>(host, port, `${BASE.users}${USERS.login}`, {
    method: 'POST',
    body: { username, password },
    timeoutMs: 10_000,
  })
  if (isErr(response)) return response

  const pair = readTokenPair(response.value)
  if (isErr(pair)) return pair
  return buildTokens(pair.value.access, pair.value.refresh)
}

export const refresh = async (
  host: string,
  port: number,
  refreshToken: string,
): Promise<Result<Tokens>> => {
  const response = await request<unknown>(host, port, `${BASE.users}${USERS.refresh}`, {
    method: 'POST',
    body: { refresh_token: refreshToken },
    timeoutMs: 10_000,
  })
  if (isErr(response)) return response

  const pair = readTokenPair(response.value)
  if (isErr(pair)) return pair
  return buildTokens(pair.value.access, pair.value.refresh)
}

/**
 * Holds the tokens for one device and renews them at most once at a time.
 *
 * `now` is injected so the renewal window is testable without waiting three hours and
 * without a clock-dependent test.
 */
export class TokenHolder {
  private tokens: Tokens | null = null
  private inFlight: Promise<Result<Tokens>> | null = null

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  adopt(tokens: Tokens): void {
    this.tokens = tokens
  }

  current(): Tokens | null {
    return this.tokens
  }

  clear(): void {
    this.tokens = null
    this.inFlight = null
  }

  /** Returns a usable access token, renewing first if it is close to expiry. */
  async accessToken(): Promise<Result<string>> {
    const tokens = this.tokens
    if (tokens === null) {
      return err(appError('unauthorized', 'no session for this device', 'error.unauthorized'))
    }
    if (!needsRenewal(tokens.access, this.now())) {
      return ok(tokens.accessToken)
    }

    // The refresh token itself can be expired — then renewal is pointless and the user
    // has to sign in again. Saying that plainly beats a retry loop.
    if (needsRenewal(tokens.refresh, this.now(), 0)) {
      this.clear()
      return err(
        appError('unauthorized', 'refresh token expired, sign-in required', 'error.sessionExpired'),
      )
    }

    const renewed = await this.renewOnce(tokens.refreshToken)
    return isErr(renewed) ? renewed : ok(renewed.value.accessToken)
  }

  /** Single-flight: concurrent callers share one renewal instead of racing it. */
  private async renewOnce(refreshToken: string): Promise<Result<Tokens>> {
    if (this.inFlight !== null) return this.inFlight

    this.inFlight = refresh(this.host, this.port, refreshToken).then((result) => {
      this.inFlight = null
      if (isErr(result)) {
        this.clear()
        return result
      }
      this.tokens = result.value
      return result
    })

    return this.inFlight
  }
}
