/**
 * What on a screenshot cannot have come from the recorded device.
 *
 * 🔴 Why this exists, measured 2026-08-09: the first run of `scripts/screenshots.mjs` wrote the
 * author's real tailnet into the first picture — its name, three peer hostnames and their 100.x
 * addresses. The device in those pictures is a scrubbed recording, and that was taken as
 * covering the screen. It does not: the Tailscale panel does not ask the device, it asks the
 * LOCAL daemon, and that one is real. A recording vouches for what it recorded and for nothing
 * else that happens to share the screen with it.
 *
 * A human noticed it by looking at the picture. That is not a mechanism, so this is one.
 *
 * Its own module, with no imports at all: the test that keeps it honest must not drag Playwright
 * into a browser-targeted type-check, and a guard nobody can test is a hope.
 */

/**
 * The one address the pictures may contain — the loopback the fake device replays on.
 *
 * Stated as what IS allowed rather than as a list of what is not. A blocklist of the author's
 * own addresses would have to contain them in order to work, which is the thing being avoided;
 * "anything but the replayed address is a leak" needs to know nothing private and still catches
 * every case, including the ones nobody thought of.
 */
export const ALLOWED_ADDRESS = '127.0.0.1'

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g

/**
 * Home directories of real people.
 *
 * 🔴 The second live source on the same screen, found the same day: the "take over from the old
 * client" panel scans the running user's `~/.config` and renders the paths it found, with the
 * user name in every one of them, next to the addresses those installations last connected to.
 * Screenshots are taken with a throwaway HOME under the system temp directory, so any `/home/`
 * on screen means the app looked somewhere it was not supposed to look during a capture.
 */
const HOME_PATH = /\/home\/[^\s/]+/g

/** Words that only ever appear when the real local daemon has answered. */
const LIVE_LABELS = ['Tailnet', 'tailnet']

/**
 * @param {string} text  the rendered text of the window
 * @returns {{ masked: string[], count: number, labels: string[], homes: string[] }}
 *   Addresses are reduced to their first octet and home paths to `/home/<user>`. A guard that
 *   reports the value it caught writes it into the log it exists to keep it out of.
 */
export const findPrivate = (text) => {
  const addresses = [...text.matchAll(IPV4)]
    .map(([hit]) => hit)
    .filter((hit) => hit !== ALLOWED_ADDRESS)
  const homes = [...text.matchAll(HOME_PATH)].map(() => '/home/<user>')
  return {
    // Deduplicated AFTER masking, not before: three addresses in one subnet are one fact for
    // a reader, and `['100.x.x.x', '100.x.x.x', '100.x.x.x']` only looks like three.
    masked: [...new Set(addresses.map((hit) => `${hit.split('.')[0]}.x.x.x`))],
    count: addresses.length,
    labels: LIVE_LABELS.filter((needle) => text.includes(needle)),
    homes: [...new Set(homes)],
  }
}

/** True when nothing on this screen came from outside the recording. */
export const isClean = (found) =>
  found.count === 0 && found.labels.length === 0 && found.homes.length === 0
