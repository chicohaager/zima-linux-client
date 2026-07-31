import catalogue from '../../renderer/src/i18n/locales/en_US.json'

/**
 * Every key the English catalogue defines, flattened to its dotted form.
 *
 * Used by the verification probes to answer "is a raw i18n key visible?" by asking
 * whether the token IS a key, rather than whether it looks like one.
 *
 * 🔴 The looks-like-one version reported the files `location.sh` and `wechseln.sh` — real
 * names in a real directory listing — as untranslated interface text, and a tour run
 * failed because of it. It matched `word.word` and then subtracted a hand-kept list of
 * file extensions, which is a guess about someone else's file names. The catalogue is a
 * fact, and `en_US` is the right one to read: it is the fallback every locale resolves
 * against, so a key that is missing everywhere still appears here.
 */
export const CATALOGUE_KEYS: readonly string[] = ((): readonly string[] => {
  const out: string[] = []
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node !== 'object' || node === null) return
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'object' && value !== null) walk(value, `${prefix}${key}.`)
      else out.push(`${prefix}${key}`)
    }
  }
  walk(catalogue, '')
  return out
})()

/**
 * The catalogue's top-level namespaces (`nav`, `device`, `files`, …).
 *
 * 🔴 These exist because matching only against known keys was a false negative machine.
 * On 2026-07-30 `device.connection.tailscale` was rendered raw on a user's screen while
 * the tour reported "no raw i18n keys" — the key was **missing** from the catalogue, so
 * asking "is this a known key?" could never find it. That is the most common way a raw key
 * appears at all: a new enum value with no translation behind it.
 *
 * So a token counts if it is a known key (translated nowhere) OR if it starts with a
 * namespace the catalogue owns (a key that should exist and does not). The namespace test
 * is what makes a *missing* key visible, and it still leaves the device's own files alone:
 * `location.sh` and `wechseln.sh` — the two real filenames the previous pattern accused —
 * do not begin with a namespace.
 */
const NAMESPACES: readonly string[] = Array.from(
  new Set(CATALOGUE_KEYS.map((key) => key.split('.')[0]).filter((part): part is string => part !== undefined)),
)

/**
 * The detection snippet, injected into the renderer.
 *
 * Returned as source text because it runs inside `executeJavaScript`, where the key list
 * has to arrive as a literal.
 */
export const RAW_KEY_SCAN = `(() => {
  const known = new Set(${JSON.stringify(CATALOGUE_KEYS)})
  const namespaces = new Set(${JSON.stringify(NAMESPACES)})
  const text = document.body.innerText || ''
  return Array.from(new Set(
    (text.match(/\\b[a-z][a-zA-Z]+(?:\\.[a-zA-Z-]+)+\\b/g) || []).filter(
      // Known key on screen: a translation that resolved to its own key.
      // Namespace prefix but unknown: a key the code asked for and the catalogue lacks.
      (m) => known.has(m) || namespaces.has(m.split('.')[0])
    )
  ))
})()`
