import { describe, expect, it } from 'vitest'
import { isErr } from '@shared/result'
import { decodeClaims } from '../jwt'

/*
 * ZimaOS v1.7.1-beta1 renamed the ACCESS token issuer from `casaos` to `zimaos` and left
 * the refresh issuer alone. The client refused the unknown name — correctly, by its own
 * design — and every sign-in failed with `unknown token issuer "zimaos"`, measured in the
 * running app: the connection path was healthy, the login was not.
 *
 * Measured 2026-08-31 by logging in against the device and decoding both payloads:
 *   access  { iss: "zimaos",  role: "admin", exp, iat, nbf, id, username }
 *   refresh { iss: "refresh", role: "admin", exp, iat, nbf, id, username }
 *
 * These tests pin BOTH names, so removing the old one to "clean up" goes red — that would
 * break every device still on v1.7.0, which is the same outage pointed the other way.
 */

const b64url = (o: unknown): string =>
  Buffer.from(JSON.stringify(o)).toString('base64url')

/** A token with the measured claim set; only `iss` varies per case. */
const tokenWith = (iss: string): string =>
  [
    b64url({ alg: 'ES256', typ: 'JWT' }),
    b64url({
      iss,
      username: 'someone',
      role: 'admin',
      id: 1,
      iat: 1_788_163_196,
      nbf: 1_788_163_196,
      exp: 1_788_173_996,
    }),
    'signature-not-verified-by-this-client',
  ].join('.')

describe('which token issuers this client accepts', () => {
  it('accepts "zimaos" as an access token — v1.7.1-beta1', () => {
    const claims = decodeClaims(tokenWith('zimaos'))

    expect(isErr(claims)).toBe(false)
    if (isErr(claims)) return
    expect(claims.value.kind).toBe('access')
  })

  it('still accepts "casaos" as an access token — v1.7.0 and earlier', () => {
    // The half that is easy to lose: a rename that replaces instead of adding just moves
    // the failure to the devices nobody is looking at.
    const claims = decodeClaims(tokenWith('casaos'))

    expect(isErr(claims)).toBe(false)
    if (isErr(claims)) return
    expect(claims.value.kind).toBe('access')
  })

  it('still reads "refresh" as a refresh token — it did NOT change', () => {
    const claims = decodeClaims(tokenWith('refresh'))

    expect(isErr(claims)).toBe(false)
    if (isErr(claims)) return
    expect(claims.value.kind).toBe('refresh')
  })

  it('still refuses an issuer nobody measured', () => {
    /*
     * The counter-control, and the reason this map is not simply removed. Refusing an
     * unknown issuer is what stops a refresh token being spent as a session credential —
     * both are signed with the same key, so `iss` is the only thing telling them apart.
     * A fix that made every issuer acceptable would have "worked" too, and silently.
     */
    const claims = decodeClaims(tokenWith('something-else'))

    expect(isErr(claims)).toBe(true)
    if (!isErr(claims)) return
    expect(claims.error.kind).toBe('unauthorized')
    expect(claims.error.context?.['issuer']).toBe('something-else')
  })
})
