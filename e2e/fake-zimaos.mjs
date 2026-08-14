/**
 * Replays a scrubbed recording of a real ZimaOS device.
 *
 * This is what lets the end-to-end suite run in CI, where there is no ZimaOS on the network.
 * Every answer it gives was measured on a real v1.7.0 host (see `scrub-fixture.mjs` for what
 * was removed and why) — it is a replay, not an imitation. That distinction is the whole
 * point: a hand-written fake encodes what I *believe* the device answers, and a suite built
 * on it is green about my beliefs.
 *
 * Two rules it holds to:
 *
 *  - An unknown request is answered 501 with the path in the body, never 200 and never an
 *    empty list. A fake that invents a plausible answer for something it never saw turns a
 *    missing fixture into a passing test.
 *  - Binary bodies (thumbnails) are served as a generated placeholder of the right media
 *    type. Someone's photographs are not test data.
 *
 * Usage: ZIMA_FIXTURE=e2e/fixtures/zimaos-session.json node e2e/fake-zimaos.mjs
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'

const fixturePath = process.env['ZIMA_FIXTURE'] ?? 'e2e/fixtures/zimaos-session.json'
const port = Number(process.env['ZIMA_FAKE_PORT'] ?? '80')

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))

/**
 * path-without-query -> the recorded text answer.
 *
 * Keyed without the query string because the client's queries carry timestamps and paging
 * offsets that will not repeat. Where the query genuinely selects the content — thumbnails —
 * the handler below deals with it instead.
 */
const byPath = new Map()
for (const exchange of fixture.exchanges) {
  const key = `${exchange.method} ${exchange.path.split('?')[0]}`
  if (!byPath.has(key)) byPath.set(key, exchange)
}

/** A 1x1 PNG. Enough for `img.complete && naturalWidth > 0`, which is what is asserted. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Requests served, so a test can assert the client really went through this server. */
const served = []

/**
 * Gateway routes this replay withholds, set at runtime by `POST /__without`.
 *
 * 🔴 Why this exists: the recorded device HAS the photos module, so every test and every
 * screenshot has only ever seen `hasLibrary === true`. The Photos tab's OTHER half — the
 * folder grid, which is the whole experience on a device without the module — was covered
 * by nothing: not the E2E suite, not a unit test, not the by-hand walk on Zorin. The first
 * person to run it was a tester on 2026-08-11, and he got HTTP 400.
 *
 * What is honest about this, and what is not:
 *
 *  - REMOVING a route from a recorded route table is a subtraction from a measurement. A
 *    device without the module does not list `/v2/photos`; `deriveCapabilities` reads exactly
 *    that list, so the capability set the client computes here is the real one.
 *  - The 404 below is NOT measured for a missing gateway route. `{"message":"no matching
 *    operation was found"}` was measured on `/v2/zimaos/sys/hardware`, an implemented service
 *    asked for an unimplemented operation. It is here so a slip-up is loud rather than
 *    plausible — and the test asserts the client never asks, which is what makes the guess
 *    harmless.
 */
let withheld = []

const isWithheld = (path) => withheld.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))

/**
 * The recorded route table minus the withheld routes.
 *
 * Fails loudly rather than silently passing the recording through: if nothing was removed
 * while something was asked for, the test would run against a device that still has the
 * module and would be green about the wrong world.
 */
const withoutWithheldRoutes = (recordedText) => {
  if (withheld.length === 0) return recordedText
  const routes = JSON.parse(recordedText)
  const kept = routes.filter((route) => !isWithheld(route.path))
  if (kept.length === routes.length) {
    throw new Error(`asked to withhold ${withheld.join(', ')} but the recorded table has none of them`)
  }
  return JSON.stringify(kept)
}

const credentials = fixture.credentials ?? { username: 'zima', password: 'zima-e2e-password' }

/**
 * Sign-in, decided by the credential rather than by the path.
 *
 * Both answers are measurements from the same device: 200 with a token envelope, and 400
 * with `success: 10013`. The wrong-password case is here because its HTTP status is 400 —
 * the same status the files API uses for "invalid path" — and a client that maps by status
 * alone tells the user their path is wrong when their password is. That is a real defect
 * this project already had once; a suite that only exercises the happy path cannot see it.
 */
const loginVariant = (variant) =>
  fixture.exchanges.find(
    (e) => e.method === 'POST' && e.path.split('?')[0] === '/v1/users/login' && e.variant === variant,
  )

/**
 * Mints a token that is valid NOW.
 *
 * 🔴 The fixture's tokens carry the expiry they were scrubbed with, which is a fixed date in
 * the past — the client read them, found them expired, went to renew, and the sign-in never
 * completed. The symptom was "no session after 30 s", which looks like a broken login and was
 * a stale fixture: a recording is a measurement of a moment, and anything time-bound in it
 * decays. So the *shape* comes from the recording and the *clock* comes from now.
 *
 * The claims are the ones the client reads: `iss` (pinned — `casaos` for access, `refresh`
 * for the renewal token), `role`, `exp`. The signature is deliberately nonsense; this client
 * does not verify it, being the client rather than the resource server.
 */
const mintToken = (iss, secondsValid) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return [
    b64({ alg: 'ES256', typ: 'JWT' }),
    // 🔴 `iat` and `nbf` are not decoration. The client's parser refuses a token without a
    // numeric `iat` — and rightly so, since every measured ZimaOS token carries
    // `username, role, id, iss, exp, nbf, iat`. Minting only `exp` produced
    // "Anmeldung erforderlich oder Sitzung abgelaufen" right after a successful HTTP 200
    // login, which reads as a broken session and was a fake that answered in a shape the
    // device never uses. A replay has to match the measured shape, not the part I needed.
    b64({
      id: 1,
      username: credentials.username,
      role: 'admin',
      iss,
      iat: now,
      nbf: now,
      exp: now + secondsValid,
    }),
    'not-a-real-signature',
  ].join('.')
}

/** The recorded success body with fresh tokens substituted, structure untouched. */
const freshLoginBody = (recordedText) => {
  const body = JSON.parse(recordedText)
  if (body?.data?.token !== undefined) {
    body.data.token.access_token = mintToken('casaos', 10_800)
    body.data.token.refresh_token = mintToken('refresh', 604_800)
    body.data.token.expires_at = Math.floor(Date.now() / 1000) + 10_800
  }
  return JSON.stringify(body)
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  served.push(`${req.method} ${path}`)

  if (req.method === 'POST' && path === '/v1/users/login') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      let sent = {}
      try {
        sent = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        sent = {}
      }
      const good =
        sent.username === credentials.username && sent.password === credentials.password
      const exchange = good ? loginVariant(undefined) : loginVariant('invalid-credentials')
      if (exchange === undefined) {
        res.writeHead(501, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'no login recording for this case', good }))
        return
      }
      res.writeHead(exchange.status, { 'content-type': 'application/json' })
      res.end(good ? freshLoginBody(exchange.body.text) : exchange.body.text)
    })
    return
  }

  // Test control: which routes this device shall claim not to have. `[]` restores the
  // recording. Answers with the state it now holds, so a caller cannot assume it took.
  //
  // Above `req.resume()` on purpose: that call consumes the body, and a handler that
  // registers its `data` listener afterwards reads an empty one.
  if (path === '/__without') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const wanted = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        withheld = Array.isArray(wanted) ? wanted.map(String) : []
      } catch {
        withheld = []
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ withheld }))
    })
    return
  }

  // Consume the request body; without this a POST with a body can stall.
  req.resume()

  if (isWithheld(path)) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'no matching operation was found' }))
    return
  }

  if (path.endsWith('/thumbnail') || path.endsWith('/image') || path.includes('/icon')) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
    res.end(PLACEHOLDER_PNG)
    return
  }

  if (path === '/__nonce') {
    // The identity challenge. Without it, "port 80 answers" is all the suite knows, and a
    // stale container or a second checkout would be indistinguishable from this process.
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(process.env['ZIMA_FAKE_NONCE'] ?? '(no nonce set)')
    return
  }

  if (path === '/__served') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(served))
    return
  }

  const exchange = byPath.get(`${req.method} ${path}`)
  if (exchange === undefined || exchange.body?.kind !== 'text') {
    // Loud, and specific about what is missing. "501 unknown path" with the path in it has
    // sent someone straight to the fixture; a silent `{}` would have sent them into the
    // client.
    res.writeHead(501, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: 'no recording for this request',
        method: req.method,
        path,
        hint: `record it with e2e/proxy-record.mjs, then scrub it`,
      }),
    )
    return
  }

  res.writeHead(exchange.status, {
    'content-type': exchange.contentType.length > 0 ? exchange.contentType : 'application/json',
  })
  res.end(path === '/v1/gateway/routes' ? withoutWithheldRoutes(exchange.body.text) : exchange.body.text)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`fake ZimaOS on :${port} replaying ${byPath.size} distinct paths from ${fixturePath}`)
})
