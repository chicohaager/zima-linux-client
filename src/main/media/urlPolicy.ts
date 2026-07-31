/**
 * Which icon URLs this client is willing to fetch.
 *
 * The rule exists because app icons are **not** our data: they come from the app metadata on
 * the device, which in turn comes from a store entry that anyone can write. `media/protocol.ts`
 * fetches them from the MAIN process, so whatever a metadata author writes becomes a request
 * issued from inside the user's network, by a program the user trusts.
 *
 * That is server-side request forgery with the roles swapped: the "server" is this desktop
 * app, and the reachable surface is everything the user's machine can reach and a remote
 * attacker cannot — `127.0.0.1`, the router's admin page, a printer, a Kubernetes API on the
 * LAN. The answer is nearly invisible (it only renders when it is an image), which makes it a
 * *blind* SSRF; the request itself is the damage, because a plain GET is enough to trip
 * endpoints that act on being called.
 *
 * So: a foreign host may not be a loopback, link-local, private or unique-local address.
 *
 * **The device itself is exempt** — it lives on exactly such an address, and its own icons are
 * the normal case.
 *
 * 🔴 Honest limit, stated rather than implied: this checks the *literal* in the URL. A DNS
 * name that resolves to 127.0.0.1 still passes, because `net.fetch` gives no hook between
 * resolution and connection, so there is no place to check the resolved address without
 * reimplementing the fetch. What this does stop is the direct form and — via `redirectAllowed`
 * — the redirect form, which is how it is done in practice.
 */

export interface UrlVerdict {
  readonly allowed: boolean
  /** Why not. Always set when `allowed` is false — a refusal without a reason is unloggable. */
  readonly reason: string | null
}

const ALLOW: UrlVerdict = { allowed: true, reason: null }

/** IPv4 literal → its four octets, or null when the host is not an IPv4 literal. */
const ipv4Octets = (host: string): readonly number[] | null => {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1))
  return octets.every((value) => value >= 0 && value <= 255) ? octets : null
}

const isPrivateIpv4 = (octets: readonly number[]): boolean => {
  const [a = 0, b = 0] = octets
  if (a === 127) return true // loopback
  if (a === 10) return true // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT — where tailnets live
  if (a === 0) return true // "this host"
  return false
}

const isPrivateIpv6 = (host: string): boolean => {
  // URL.hostname keeps IPv6 in brackets; normalise before comparing.
  const address = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
  if (address === '::1' || address === '::') return true
  if (address.startsWith('fe80:')) return true // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true // unique local fc00::/7
  /*
   * ::ffff:127.0.0.1 and friends — an IPv4 loopback wearing an IPv6 hat.
   *
   * 🔴 The first version of this matched only the DOTTED form and let
   * `http://[::ffff:127.0.0.1]/` straight through. `URL` normalises it to the HEX form
   * (`[::ffff:7f00:1]`, measured with node), so the pattern I had written from imagination
   * could never fire. Its own test caught it — which is the entire reason the refusal list
   * is a test and not a comment.
   */
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address)
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16)
    const low = Number.parseInt(hex[2], 16)
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff])
  }
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
  if (dotted?.[1] !== undefined) {
    const octets = ipv4Octets(dotted[1])
    return octets !== null && isPrivateIpv4(octets)
  }
  return false
}

/**
 * Is this host literal in a loopback, private or link-local range?
 *
 * Exported so `apps.ts` can ask the same question with the same answer — the ranges are
 * defined once. Same honest limit as the whole module: this reads the literal in the URL and
 * performs no DNS lookup.
 */
export const isPrivateHostLiteral = (host: string): boolean => {
  const normalised = host.toLowerCase()
  if (normalised === 'localhost' || normalised.endsWith('.localhost')) return true
  const octets = ipv4Octets(normalised)
  if (octets !== null) return isPrivateIpv4(octets)
  if (normalised.includes(':')) return isPrivateIpv6(normalised)
  return false
}

/**
 * May this icon URL be fetched at all?
 *
 * @param raw       the URL as it stands in the app metadata
 * @param deviceHost the host of the active device — exempt, because that is where legitimate
 *                   icons live and it is itself a private address
 */
export const iconFetchAllowed = (raw: string, deviceHost: string): UrlVerdict => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { allowed: false, reason: 'not a URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `scheme ${url.protocol} is not fetchable` }
  }

  const host = url.hostname.toLowerCase()
  if (host === deviceHost.toLowerCase()) return ALLOW

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { allowed: false, reason: 'points at this machine (localhost)' }
  }
  const octets = ipv4Octets(host)
  if (octets !== null && isPrivateIpv4(octets)) {
    return { allowed: false, reason: `points into a private or loopback range (${host})` }
  }
  if (host.includes(':') && isPrivateIpv6(host)) {
    return { allowed: false, reason: `points into a private or loopback range (${host})` }
  }
  return ALLOW
}

/**
 * The same question for the URL a redirect actually landed on.
 *
 * Separate function because the failure it prevents is separate: a public CDN answering
 * `302 -> http://127.0.0.1:9997/…` defeats the check above entirely, and redirects have to be
 * followed for jsdelivr and github to work at all.
 */
export const redirectAllowed = (finalUrl: string, requested: string, deviceHost: string): UrlVerdict => {
  /*
   * 🔴 "The fetch told me nothing" is its own answer, not a redirect to a bad host.
   *
   * Measured 2026-07-31: Electron's `net.fetch` leaves `response.url` EMPTY on every
   * answer — no redirect involved. Fed through the old code that became
   * `redirected to a host that not a URL`, and the caller refused **every** icon while
   * reporting a redirect that had never happened. Two failures in one: the guard blocked
   * the feature it was guarding, and its message sent the reader hunting for a redirect.
   *
   * Still fails closed — an unverifiable landing host must not be served — but it now says
   * which of the two things went wrong. `protocol.ts` documents the stack that answers this
   * question truthfully.
   */
  if (finalUrl.length === 0) {
    return { allowed: false, reason: 'the fetch reported no final URL, so the landing host is unverifiable' }
  }
  if (finalUrl === requested) return ALLOW
  const verdict = iconFetchAllowed(finalUrl, deviceHost)
  return verdict.allowed ? ALLOW : { allowed: false, reason: `redirected to a host that ${verdict.reason}` }
}
