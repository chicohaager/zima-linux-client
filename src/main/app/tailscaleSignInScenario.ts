import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ScenarioResult } from './scenarios'
import { runTour } from './tourScenario'

/**
 * Signs in over a Tailscale address the way a user does, then walks the app.
 *
 * This exists because "works over Tailscale" was, until now, an inference: the panel lists
 * peers, the probe takes any host, so surely the tunnel works. That is the shape of every
 * mistake this project has written down — measuring the part within reach and claiming the
 * part being asserted. `curl` against the tailnet address proves the DEVICE answers; it says
 * nothing about whether the panel hands the address over, whether the sign-in stores it as a
 * tailscale address rather than downgrading it to `direct`, or whether the sections load
 * through the tunnel.
 *
 * So every step is clicked and every step is read back:
 *
 *  1. An existing session is signed OUT first. A restored session would carry the previous
 *     run's work into this one, and the report would be about a warm state I made myself.
 *  2. The peer is chosen by `data-tailscale-use="<address>"`, and a missing button reports
 *     WHICH addresses were on offer — an empty panel and a wrong address look identical
 *     otherwise.
 *  3. The prefilled host field is compared against the address that was clicked. This is the
 *     hand-over the panel is responsible for, and nothing else checks it.
 *  4. Sign-in is awaited by POLLING for the sign-out control, not by sleeping for a fixed
 *     time. A fixed sleep turns a slow tunnel into a failure and a broken login into a
 *     "flake".
 *  5. The stored session is asked what KIND of connection it recorded. `tailscale` is the
 *     whole point; `direct` here would mean the address survived and its meaning did not.
 *
 * The credential comes from the environment and is never written to the report, never
 * defaulted, and never logged. No credential means a loud failure, not a skipped check.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How long a sign-in over a tunnel may take before it counts as broken. */
const SIGN_IN_BUDGET_MS = 30_000
const POLL_MS = 500

/**
 * How the sign-in form is reached.
 *
 * `tailscale-panel` additionally proves the hand-over described above; `direct-ip` is the
 * plain manual route, used for recording and for CI, where no tailnet exists.
 */
export type SignInEntry = 'tailscale-panel' | 'direct-ip'

export const runTailscaleSignIn = async (
  window: BrowserWindow,
  host: string,
  reportPath: string,
  entry: SignInEntry = 'tailscale-panel',
): Promise<ScenarioResult> => {
  const failures: string[] = []
  const observed: Record<string, string> = { host, entry }
  const resultName = entry === 'tailscale-panel' ? 'tailscale-signin' : 'direct-signin'
  /** What the session must record for this route. */
  const expectedKind = entry === 'tailscale-panel' ? 'tailscale' : 'direct'
  const run = async (script: string): Promise<unknown> =>
    window.webContents.executeJavaScript(script, true)

  const username = process.env['ZIMA_VERIFY_USER'] ?? ''
  const password = process.env['ZIMA_VERIFY_PASSWORD'] ?? ''
  if (username.length === 0 || password.length === 0) {
    return {
      name: resultName,
      ok: false,
      observed,
      failures: ['ZIMA_VERIFY_USER and ZIMA_VERIFY_PASSWORD must both be set'],
    }
  }
  if (host.length === 0) {
    return {
      name: resultName,
      ok: false,
      observed,
      failures: ['no address — use ZIMA_VERIFY_SCENARIO=tailscale-signin:<tailnet-address>'],
    }
  }

  const signedIn = async (): Promise<boolean> =>
    Boolean(await run(`document.querySelector('[data-action="sign-out"]') !== null`))

  await sleep(3_500)

  // 1. Start cold. A session restored from the keyring would let every later assertion pass
  //    without a single byte crossing the tunnel.
  observed['startedSignedIn'] = String(await signedIn())
  if (observed['startedSignedIn'] === 'true') {
    await run(`document.querySelector('[data-action="sign-out"]').click()`)
    for (let waited = 0; waited < 10_000 && (await signedIn()); waited += POLL_MS) {
      await sleep(POLL_MS)
    }
    observed['signedOutFirst'] = String(!(await signedIn()))
    if (observed['signedOutFirst'] !== 'true') {
      failures.push('the existing session could not be signed out; the run would be warm')
      return { name: resultName, ok: false, observed, failures }
    }
    await sleep(1_000)
  }

  // 2. Reach the form.
  if (entry === 'tailscale-panel') {
    //  Pick the peer. The panel only renders online peers, so a missing button is a real
    //  finding — and the report names what was there instead of just saying "not found".
    const offered = (await run(`Array.from(
      document.querySelectorAll('[data-tailscale-use]'),
    ).map((b) => b.getAttribute('data-tailscale-use')).join(',')`)) as string
    observed['peersOffered'] = offered.length === 0 ? '(none)' : offered

    const clicked = (await run(`(() => {
      const target = document.querySelector('[data-tailscale-use=' + ${JSON.stringify(
        JSON.stringify(host),
      )} + ']')
      if (!target) return 'missing-peer-button'
      target.click()
      return 'ok'
    })()`)) as string
    observed['usePeer'] = clicked
    if (clicked !== 'ok') {
      failures.push(
        `the Tailscale panel offered no button for ${host} (offered: ${observed['peersOffered']})`,
      )
      return { name: resultName, ok: false, observed, failures }
    }
  } else {
    const clicked = (await run(`(() => {
      const target = document.querySelector('[data-action="direct-ip"]')
      if (!target) return 'missing-direct-ip-button'
      target.click()
      return 'ok'
    })()`)) as string
    observed['openDirectIp'] = clicked
    if (clicked !== 'ok') {
      failures.push('the "connect by IP address" button was not found')
      return { name: resultName, ok: false, observed, failures }
    }
  }

  await sleep(800)

  // 3. For the panel route: did the address actually land in the form? That hand-over is
  //    the panel's job and nothing else checks it. The manual route types the host itself,
  //    so there the field is expected to start empty.
  const prefilled = (await run(`(() => {
    const input = document.querySelector('input[name="host"]')
    return input ? input.value : 'missing-host-field'
  })()`)) as string
  observed['prefilledHost'] = prefilled
  if (entry === 'tailscale-panel' && prefilled !== host) {
    failures.push(`the sign-in form was prefilled with "${prefilled}" instead of "${host}"`)
  }
  if (prefilled === 'missing-host-field') {
    failures.push('the sign-in form did not open')
    return { name: resultName, ok: false, observed, failures }
  }

  // 4. Type and submit. The value goes through the native setter so React's state changes;
  //    assigning `.value` updates the DOM only and submits an empty form.
  const typed = (await run(`(() => {
    const set = (name, value) => {
      const input = document.querySelector('input[name="' + name + '"]')
      if (!input) return 'missing:' + name
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    }
    const h = set('host', ${JSON.stringify(host)})
    if (h !== 'ok') return h
    const u = set('username', ${JSON.stringify(username)})
    if (u !== 'ok') return u
    return set('password', ${JSON.stringify(password)})
  })()`)) as string
  // Deliberately not recording what was typed — only whether the fields existed.
  observed['fillCredentials'] = typed
  if (typed !== 'ok') {
    failures.push(`sign-in form incomplete: ${typed}`)
    return { name: resultName, ok: false, observed, failures }
  }

  await sleep(300)
  const submitted = (await run(`(() => {
    const input = document.querySelector('input[name="password"]')
    const form = input ? input.closest('form') : null
    if (!form) return 'missing-form'
    form.requestSubmit()
    return 'ok'
  })()`)) as string
  observed['submit'] = submitted
  if (submitted !== 'ok') {
    failures.push('the sign-in form could not be submitted')
    return { name: resultName, ok: false, observed, failures }
  }

  let waited = 0
  while (waited < SIGN_IN_BUDGET_MS && !(await signedIn())) {
    await sleep(POLL_MS)
    waited += POLL_MS
  }
  observed['signInMs'] = String(waited)

  if (!(await signedIn())) {
    // The screen is part of the failure. "Sign-in did not complete" without the rendered
    // text sends the reader looking in the wrong component.
    observed['screen'] = String(await run(`(document.body.innerText || '').slice(0, 2000)`))
    failures.push(`no session after ${SIGN_IN_BUDGET_MS} ms over ${host}; see observed.screen`)
    const shot = await window.webContents.capturePage()
    await writeFile(join(dirname(reportPath), `${resultName}-failed.png`), shot.toPNG())
    return { name: resultName, ok: false, observed, failures }
  }

  // 5. What did the session RECORD? An address that works but is stored as `direct` breaks
  //    the next start, when the tunnel has to be recognised again.
  //    Only the two fields under test are read back. The summary also carries the account
  //    name, and a verification report has no business collecting one.
  const stored = (await run(`window.zima.currentSession({}).then((r) =>
    r && r.ok ? [r.value.host, r.value.port, r.value.kind].join('|') : 'error:' + JSON.stringify(r),
  )`)) as string
  observed['sessionAddress'] = stored
  if (!stored.startsWith(`${host}|`)) {
    failures.push(`the stored session names "${stored}" instead of the tailnet address ${host}`)
  }
  if (!stored.endsWith(`|${expectedKind}`)) {
    failures.push(
      `the session records kind "${stored.split('|').pop() ?? ''}" instead of "${expectedKind}" — the address survived, its meaning did not`,
    )
  }

  const shot = await window.webContents.capturePage()
  await writeFile(join(dirname(reportPath), `${resultName}-signed-in.png`), shot.toPNG())

  // 6. Having a session is not having a working app. The tour clicks all four sections and
  //    asserts on what they rendered — over this tunnel, with this session.
  const tour = await runTour(window, reportPath)
  for (const [key, value] of Object.entries(tour.observed)) observed[`tour.${key}`] = value
  failures.push(...tour.failures.map((f) => `tour: ${f}`))

  return { name: resultName, ok: failures.length === 0, observed, failures }
}
