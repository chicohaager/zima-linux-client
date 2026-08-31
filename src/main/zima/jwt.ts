import { appError, err, ok, type Result } from '@shared/result'

/**
 * Reads the claims of a ZimaOS token.
 *
 * Measured properties (ZimaOS v1.7.0): ES256, header `{"alg":"ES256","typ":"JWT"}`
 * without `kid`. Payload: `username, role, id, iss, exp, nbf, iat`. The access token
 * carries `iss: "casaos"` and lives ~3 h; the refresh token carries `iss: "refresh"`
 * and lives ~7 days — and both are signed with the SAME key.
 *
 * 🔴 Re-measured 2026-08-31 on v1.7.1-beta1: the ACCESS issuer changed to `"zimaos"`,
 * the refresh issuer did NOT (still `"refresh"`), and the claim set is unchanged
 * (`exp, iat, id, iss, nbf, role, username`). Exactly one of the two moved, which is
 * why both are listed in the map below rather than one being renamed — a device on
 * older firmware still says `casaos`, and this client talks to both.
 *
 * 🔴 That last point is why `iss` is pinned here. Anything that checks only the
 * signature and `exp` accepts the long-lived refresh token as a full session. This
 * client must never send a refresh token as a session credential, so the two types are
 * distinguished by name and cannot be mixed up by accident.
 *
 * What this module deliberately does NOT do: verify the signature. We are the client,
 * not the resource server — the token is issued to us over the same channel we then
 * use, and validating it locally would not add a security property. The device decides
 * whether a token is acceptable. (A ZimaOS *module backend* is the opposite case: it
 * must verify ES256 against the JWKS at /.well-known/jwks.json.)
 */

export type TokenKind = 'access' | 'refresh'

export interface TokenClaims {
  readonly kind: TokenKind
  readonly username: string
  readonly role: string
  readonly issuer: string
  /** Expiry as epoch milliseconds. */
  readonly expiresAtMs: number
  readonly issuedAtMs: number
}

/*
 * Issuer -> token kind. ADDITIVE by design: every issuer a supported firmware has ever
 * used stays here.
 *
 * `zimaos` was added 2026-08-31 after v1.7.1-beta1 renamed the access issuer. Until then
 * the login died with `unknown token issuer "zimaos"` — the refusal below doing exactly
 * what it was written to do, on a name nobody had measured since v1.7.0. Both entries are
 * kept because the same client also talks to devices that still issue `casaos`, and
 * replacing rather than adding would just move the outage to those.
 *
 * Measured on v1.7.1-beta1: access `iss: "zimaos"`, refresh `iss: "refresh"`.
 * Measured on v1.7.0:       access `iss: "casaos"`, refresh `iss: "refresh"`.
 */
const ISSUER_TO_KIND: Readonly<Record<string, TokenKind>> = {
  casaos: 'access',
  zimaos: 'access',
  refresh: 'refresh',
}

const decodeSegment = (segment: string): unknown => {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
  const json = Buffer.from(padded, 'base64').toString('utf8')
  return JSON.parse(json)
}

export const decodeClaims = (token: string): Result<TokenClaims> => {
  const segments = token.split('.')
  if (segments.length !== 3) {
    return err(
      appError('unauthorized', `token has ${segments.length} segments, expected 3`, 'error.unauthorized'),
    )
  }

  let payload: unknown
  try {
    payload = decodeSegment(segments[1] ?? '')
  } catch (cause) {
    return err(
      appError('malformed-response', 'token payload is not base64url JSON', 'error.unauthorized', undefined, cause),
    )
  }

  if (typeof payload !== 'object' || payload === null) {
    return err(appError('malformed-response', 'token payload is not an object', 'error.unauthorized'))
  }

  const claims = payload as Record<string, unknown>
  const issuer = typeof claims['iss'] === 'string' ? claims['iss'] : ''
  const kind = ISSUER_TO_KIND[issuer]

  // An unknown issuer is refused rather than defaulted to 'access'. Defaulting here
  // would be the exact mistake this module exists to prevent.
  if (kind === undefined) {
    return err(
      appError('unauthorized', `unknown token issuer "${issuer}"`, 'error.unauthorized', { issuer }),
    )
  }

  const exp = claims['exp']
  const iat = claims['iat']
  if (typeof exp !== 'number' || typeof iat !== 'number') {
    return err(appError('malformed-response', 'token lacks numeric exp/iat', 'error.unauthorized'))
  }

  return ok({
    kind,
    username: typeof claims['username'] === 'string' ? claims['username'] : '',
    role: typeof claims['role'] === 'string' ? claims['role'] : '',
    issuer,
    expiresAtMs: exp * 1000,
    issuedAtMs: iat * 1000,
  })
}

/**
 * True when the token should be renewed. The skew is generous on purpose: renewing a
 * little early costs one request, while renewing too late costs the user a failed
 * action they have to repeat.
 */
export const needsRenewal = (claims: TokenClaims, nowMs: number, skewMs = 120_000): boolean =>
  claims.expiresAtMs - skewMs <= nowMs

/** Rejects a token that is not of the expected kind. */
export const requireKind = (claims: TokenClaims, expected: TokenKind): Result<TokenClaims> =>
  claims.kind === expected
    ? ok(claims)
    : err(
        appError(
          'unauthorized',
          `expected a ${expected} token but got ${claims.kind} (iss=${claims.issuer})`,
          'error.unauthorized',
          { expected, actual: claims.kind },
        ),
      )
