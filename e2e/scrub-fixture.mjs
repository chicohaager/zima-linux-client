/**
 * Turns a recording of a real device into fixtures that may be published.
 *
 * The recording is a measurement and therefore valuable; it is also a dump of someone's
 * device — folder names, photo paths, installed applications, an account name, live tokens
 * and the LAN address the icons point at. None of that belongs in a repository, and the
 * project rule is explicit: shareable material carries no private data, from the first line.
 *
 * Two halves, and the second is the one that counts:
 *
 *  1. Rewriting. Structure, types, counts and sizes are preserved exactly — those are what
 *     the tests assert on. Identifying content is replaced with generated stand-ins.
 *  2. A GATE over the result. It re-reads what was written and refuses anything that still
 *     matches a private pattern. Rule 1 of this project says a rewrite I trust is a rewrite
 *     I have not checked; on 2026-08-07 a self-invented mask covered four of five secrets
 *     and printed the fifth. So the rules do not get to certify themselves.
 *
 * Usage: node e2e/scrub-fixture.mjs <recording.json> <out.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , inPath, outPath] = process.argv
if (inPath === undefined || outPath === undefined) {
  console.error('usage: node e2e/scrub-fixture.mjs <recording.json> <out.json>')
  process.exit(2)
}

/** The address every rewritten URL points at — the loopback the fake will answer on. */
const FAKE_HOST = '127.0.0.1'
const FAKE_USER = 'zima'

/**
 * A JWT of the right SHAPE, with no signature that means anything.
 *
 * The client deliberately does not verify the signature — it is the client, not the resource
 * server — but it does read `iss`, `role` and `exp`, and it pins `iss`. A fixture token must
 * therefore carry real claims and a fake signature, not a random string.
 */
const fakeJwt = (iss, secondsValid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.UTC(2026, 0, 1) / 1000)
  return [
    b64({ alg: 'ES256', typ: 'JWT' }),
    // Same claim set as every measured ZimaOS token — `iat` in particular, without which
    // the client's parser refuses the token outright.
    b64({ id: 1, username: FAKE_USER, role: 'admin', iss, iat: now, nbf: now, exp: now + secondsValid }),
    'not-a-real-signature',
  ].join('.')
}

let counter = 0
const nextId = () => {
  counter += 1
  return counter
}

/** File and directory names, replaced wholesale rather than judged one by one. */
const renameEntry = (name, isDir) => {
  const n = nextId()
  if (isDir) return `Ordner-${n}`
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  return `Datei-${n}${extension}`
}

const scrubString = (value) =>
  value
    // Any private or tailnet address, wherever it hides — including inside a URL.
    .replace(/\b(?:192\.168|10)\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/g, FAKE_HOST)
    .replace(/\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, FAKE_HOST)
    .replace(/\b100\.(?:6[4-9]|[7-9]\d|1\d\d)\.\d{1,3}\.\d{1,3}\b/g, FAKE_HOST)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'nobody@example.invalid')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/g, fakeJwt('casaos', 10_800))

const scrub = (node, key = '') => {
  if (Array.isArray(node)) return node.map((item) => scrub(item, key))
  if (node !== null && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = scrub(v, k)

    // Installed applications say a lot about whose machine this was. The COUNT and the
    // structure are what the tests need; which applications they are is nobody's business.
    if (typeof out['app_type'] === 'string' && typeof out['name'] === 'string') {
      const n = nextId()
      out['name'] = `app-${n}`
      if (out['title'] !== null && typeof out['title'] === 'object') {
        for (const language of Object.keys(out['title'])) out['title'][language] = `App ${n}`
      }
    }

    // EXIF: camera make, model and exposure settings come out of private photographs.
    if (out['camera_make'] !== undefined || out['camera_model'] !== undefined) {
      if (out['camera_make'] !== undefined) out['camera_make'] = 'ACME'
      if (out['camera_model'] !== undefined) out['camera_model'] = 'Model X'
    }

    // Directory listings: the name and the path that ends in it move together, so the
    // fixture stays internally consistent and a UI that joins them still works.
    if (typeof out['name'] === 'string' && typeof out['is_dir'] === 'boolean') {
      const renamed = renameEntry(out['name'], out['is_dir'])
      if (typeof out['path'] === 'string') {
        out['path'] = `${out['path'].slice(0, out['path'].lastIndexOf('/') + 1)}${renamed}`
      }
      out['name'] = renamed
    }
    return out
  }
  if (typeof node === 'string') {
    if (key === 'username' || key === 'nickname') return FAKE_USER
    if (key === 'access_token') return fakeJwt('casaos', 10_800)
    if (key === 'refresh_token') return fakeJwt('refresh', 604_800)
    // Photo assets: the path is a real album and a real filename.
    if (key === 'path' && /\.(jpe?g|png|heic|mp4|mov)$/i.test(node)) {
      return `/media/ZimaOS-HD/Gallery/bild-${nextId()}${node.slice(node.lastIndexOf('.'))}`
    }
    if (key === 'serial' || key === 'sn' || key === 'mac' || key === 'uuid') {
      return `redacted-${key}-${nextId()}`
    }
    return scrubString(node)
  }
  return node
}

const recording = JSON.parse(readFileSync(inPath, 'utf8'))
const scrubbed = {
  recordedFrom: 'a ZimaOS v1.7.0 device (address removed)',
  /** The credential the replay accepts. Fixture data, not a secret. */
  credentials: { username: FAKE_USER, password: 'zima-e2e-password' },
  exchanges: recording.exchanges.map((exchange) => ({
    ...exchange,
    path: scrubString(exchange.path),
    requestBody: exchange.requestBody === null ? null : '(request body removed)',
    body:
      exchange.body?.kind === 'text'
        ? { kind: 'text', text: JSON.stringify(scrub(JSON.parse(exchange.body.text))) }
        : exchange.body,
  })),
}

writeFileSync(outPath, `${JSON.stringify(scrubbed, null, 2)}\n`)

/*
 * The gate. Run over the FILE that was just written, not over the object in memory — the
 * artefact that would be committed is the thing under test.
 */
const written = readFileSync(outPath, 'utf8')
const FORBIDDEN = [
  // 🔴 These three were written wrong on the first attempt and the canary below caught it
  // within a second: `(?:192\.168|10)\.` followed by three octets demands FIVE numbers for a
  // 192.168 address and matches none of them. A gate whose pattern cannot fire is not a
  // weaker gate, it is a decoration that reports "clean" forever.
  ['192.168.x.x address', /\b192\.168\.\d{1,3}\.\d{1,3}\b/],
  ['10.x.x.x address', /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ['172.16-31.x.x address', /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/],
  ['tailnet address', /\b100\.(?:6[4-9]|[7-9]\d|1\d\d)\.\d{1,3}\.\d{1,3}\b/],
  ['e-mail address', /[\w.+-]+@(?!example\.invalid)[\w-]+\.[\w.]{2,}/],
  ['a real JWT', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.(?!not-a-real-signature)[A-Za-z0-9_-]{6,}/],
]

const violations = []
for (const [label, pattern] of FORBIDDEN) {
  const hit = pattern.exec(written)
  if (hit !== null) violations.push(`${label} survived scrubbing at offset ${hit.index}`)
}

/*
 * 🔴 And the other direction, because a gate that only ever says "clean" has never been
 * shown to work: the same patterns are run against a string that MUST trip every one of
 * them. If the sabotage passes, the gate is broken and the "clean" above meant nothing.
 *
 * This is the positive control a privacy gate in this repository once lacked for months
 * while its allowlist quietly covered the very name it was searching for.
 */
/*
 * The addresses here are the documentation values the repository's own privacy gate
 * recognises as harmless — chosen so that this canary trips MY patterns without tripping
 * THAT gate. A canary that has to be exempted from the privacy check would need an
 * exemption as wide as the check itself, which is how a gate quietly stops working.
 */
const CANARY =
  'lan 192.168.0.5, vpn 10.0.0.1, dmz 172.20.1.9, peer 100.64.0.1, ' +
  'mail a.b@example.com, token eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4'
const missed = FORBIDDEN.filter(([, pattern]) => !pattern.test(CANARY)).map(([label]) => label)
if (missed.length > 0) {
  console.error(`the scrub gate cannot detect: ${missed.join(', ')} — it proves nothing`)
  process.exit(3)
}

if (violations.length > 0) {
  console.error(`refusing to publish ${outPath}:`)
  for (const violation of violations) console.error(`  - ${violation}`)
  process.exit(1)
}

console.log(
  `scrubbed ${scrubbed.exchanges.length} exchanges -> ${outPath}; ` +
    `gate clean, and all ${FORBIDDEN.length} patterns proved themselves against the canary`,
)
