import { appError, err, isErr, ok, type Result } from '@shared/result'
import { BASE, USERS } from './endpoints'
import { request } from './client'
import {
  decodeClaims,
  needsRenewal,
  readRefreshToken,
  requireKind,
  type RefreshCredential,
  type TokenClaims,
} from './jwt'

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
  readonly refresh: RefreshCredential
}

interface LoginPayload {
  readonly token?: { readonly access_token?: unknown; readonly refresh_token?: unknown }
}

interface RefreshPayload {
  readonly access_token?: unknown
  readonly refresh_token?: unknown
}

const pairOrMalformed = (
  access: unknown,
  refresh: unknown,
  where: string,
): Result<{ access: string; refresh: string }> => {
  if (typeof access !== 'string' || typeof refresh !== 'string') {
    // A shape we do not recognise is an error, never an empty session. An empty
    // session would silently look like "not signed in" and hide a protocol change.
    return err(
      appError('malformed-response', `${where} response had an unexpected token shape`, 'error.malformedResponse'),
    )
  }
  return ok({ access, refresh })
}

/** live 2026-07-30: `data.token.{access_token,refresh_token}` — NESTED under `token`. */
const readLoginTokens = (payload: unknown): Result<{ access: string; refresh: string }> => {
  const token = (payload as LoginPayload | null)?.token
  return pairOrMalformed(token?.access_token, token?.refresh_token, 'login')
}

/**
 * live 2026-07-30 against a v1.7.0 host: `POST /v1/users/refresh` answers
 * `{"success":200,"message":"ok","data":{"refresh_token":…,"access_token":…,"expires_at":…}}`
 * — the two tokens sit **flat under `data`**, NOT nested under `token` the way login does.
 *
 * Reusing the login reader here was a real bug: renewal always failed with
 * `malformed-response`, which meant the stored refresh token was written on every sign-in
 * and could never be spent. The symptom was "device remembered, but logged out after a
 * restart". Two endpoints of the same API family, two shapes — so two readers, each
 * carrying the date its shape was measured.
 */
const readRefreshTokens = (payload: unknown): Result<{ access: string; refresh: string }> => {
  const data = payload as RefreshPayload | null
  return pairOrMalformed(data?.access_token, data?.refresh_token, 'refresh')
}

const buildTokens = (access: string, refresh: string): Result<Tokens> => {
  const accessClaims = decodeClaims(access)
  if (isErr(accessClaims)) return accessClaims

  // Pin the kinds: a server that hands back two access tokens, or swaps them, must
  // not silently produce a session that cannot be renewed. The refresh half may be a
  // JWT (up to 1.8.0-beta1) or opaque (1.8.0-beta2) — see `readRefreshToken`.
  const asAccess = requireKind(accessClaims.value, 'access')
  if (isErr(asAccess)) return asAccess
  const asRefresh = readRefreshToken(refresh)
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

  const pair = readLoginTokens(response.value)
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

  const pair = readRefreshTokens(response.value)
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
    /**
     * Called with every pair a renewal produced. The device rotates the refresh token on
     * each renewal and, on 1.8.0-beta2, treats a replay of a spent one after ~30 s as reuse
     * and revokes the whole family (measured 2026-10-08) — so the new token has to reach
     * the keyring, not only this object.
     */
    private readonly onRenewed: (tokens: Tokens) => void = () => {},
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
    // has to sign in again. Saying that plainly beats a retry loop. An opaque token
    // (1.8.0-beta2) has no readable expiry: then the device decides, and a rejection
    // drops the session in `renewOnce` exactly like an expired JWT would.
    const refreshExpiresAtMs = tokens.refresh.expiresAtMs
    if (refreshExpiresAtMs !== null && refreshExpiresAtMs <= this.now()) {
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
      this.onRenewed(result.value)
      return result
    })

    return this.inFlight
  }
}
