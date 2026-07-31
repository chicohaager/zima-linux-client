/**
 * What a ZeroTier network id is — in one place.
 *
 * The pattern was written twice: once in `transport/strategy.ts` for the Remote-ID route and
 * once in `zerotier/daemon.ts` for the API call. Two copies of a validation rule are two rules
 * that agree today; the one that gets relaxed later is the one nobody is looking at. The id is
 * interpolated into `/network/<id>` against the local daemon's authenticated API, so "relaxed"
 * means a `/` or a `?` addressing a different endpoint than the caller intended.
 *
 * 16 hexadecimal characters — the format ZimaOS reports in `GET /v2/zimaos/zt/info`.
 */
export const NETWORK_ID_PATTERN = /^[0-9a-f]{16}$/

/** Lower-cases and trims first: users paste ids with spaces and in capitals. */
export const normaliseNetworkId = (raw: string): string => raw.trim().toLowerCase()

export const isNetworkId = (raw: string): boolean => NETWORK_ID_PATTERN.test(raw)
