import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ScenarioResult } from './scenarios'
import {
  capturePng,
  CLICK_ACTION,
  FILL,
  pollUntil,
  SIGNED_IN,
  sleep,
  SUBMIT_SIGN_IN,
  waitForResumeSettled,
} from './scenarioKit'
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

/** How long a sign-in over a tunnel may take before it counts as broken. */
const SIGN_IN_BUDGET_MS = 30_000
const POLL_MS = 500
/**
 * How long the Tailscale panel may take to list its peers.
 *
 * The list comes from `tailscale status` through IPC, so it is a subprocess round-trip, not
 * a render. It used to be read exactly once after a fixed sleep — and a busy `tailscaled`
 * then produced `the Tailscale panel offered no button`, a confident negative about a
 * working app. Polling turns a slow daemon back into what it is: slow, not broken.
 */
const PEERS_BUDGET_MS = 15_000

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

  /**
   * 🔴 Every step is contained, so one rejection cannot take the report with it.
   *
   * `executeJavaScript` rejects when the page has no `window.zima` — a broken preload, which
   * this project has actually shipped once. Unwrapped, that rejection propagates out of this
   * function and `startupVerification` replaces the whole result with `observed: {}` plus
   * "scenario threw". Every measurement taken before it — the peers on offer, the prefilled
   * host, how long the sign-in took — is discarded for exactly the runs that need it most.
   *
   * A failed step therefore returns a marked string instead: the callers below already treat
   * anything but `ok` as a failure, and now the report names which step broke and keeps the
   * rest.
   */
  const failed: string[] = []
  const run = async (script: string): Promise<unknown> => {
    try {
      return await window.webContents.executeJavaScript(script, true)
    } catch (cause) {
      const note = `threw: ${String(cause).slice(0, 160)}`
      failed.push(note)
      return note
    }
  }

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
      // Names the scenario that was actually invoked. Hard-coding `tailscale-signin` here
      // sent anyone running `direct-signin` — the CI route, chosen precisely because no
      // tailnet exists there — to the panel route, which then fails for a second reason.
      failures: [`no address — use ZIMA_VERIFY_SCENARIO=${resultName}:<address>`],
    }
  }

  const signedIn = async (): Promise<boolean> => Boolean(await run(SIGNED_IN))

  // Wait for the start-up session restore to reach a terminal state instead of sleeping a
  // fixed 3.5 s. See `waitForResumeSettled` for the race that bet used to lose.
  const resume = await waitForResumeSettled(run)
  observed['resumePhase'] = resume.phase
  observed['resumeWaitMs'] = String(resume.elapsedMs)

  // 1. Start cold. A session restored from the keyring would let every later assertion pass
  //    without a single byte crossing the tunnel.
  //
  //    The booleans stay booleans and are only stringified INTO the report. Round-tripping
  //    them through `observed` and comparing against 'true' made the control flow depend on
  //    a formatting decision: a future `String(x).toUpperCase()` anywhere near here would
  //    silently flip the branch, and nothing would go red.
  const startedSignedIn = await signedIn()
  observed['startedSignedIn'] = String(startedSignedIn)
  if (startedSignedIn) {
    observed['signOutClick'] = String(await run(CLICK_ACTION('sign-out')))
    const out = await pollUntil(async () => !(await signedIn()), 10_000, POLL_MS)
    observed['signOutMs'] = String(out.elapsedMs)
    observed['signedOutFirst'] = String(out.ok)
    if (!out.ok) {
      failures.push('the existing session could not be signed out; the run would be warm')
      return { name: resultName, ok: false, observed, failures }
    }
    await sleep(1_000)
  }

  // 2. Reach the form.
  if (entry === 'tailscale-panel') {
    //  Pick the peer. The panel only renders online peers, so a missing button is a real
    //  finding — and the report names what was there instead of just saying "not found".
    //
    //  Polled, not read once: the peer list arrives from `tailscale status` over IPC, and a
    //  single read after a fixed sleep turns a slow daemon into "the panel offered no
    //  button" — a red verdict on a working app.
    const offeredScript = `Array.from(
      document.querySelectorAll('[data-tailscale-use]'),
    ).map((b) => b.getAttribute('data-tailscale-use')).join(',')`
    let offered = ''
    const peers = await pollUntil(async () => {
      offered = String(await run(offeredScript))
      // Waits for THIS host, not for any peer: a panel listing three other machines is not
      // the state this scenario needs, and stopping at the first render would race it.
      return offered.split(',').includes(host)
    }, PEERS_BUDGET_MS, POLL_MS)
    observed['peersOffered'] = offered.length === 0 ? '(none)' : offered
    observed['peersWaitMs'] = String(peers.elapsedMs)

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
        `the Tailscale panel offered no button for ${host} within ${PEERS_BUDGET_MS} ms ` +
          `(offered: ${observed['peersOffered']})`,
      )
      return { name: resultName, ok: false, observed, failures }
    }
  } else {
    const clicked = String(await run(CLICK_ACTION('direct-ip')))
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

  // 4. Type and submit, through the shared FILL: the value goes via the native setter so
  //    React's state changes — assigning `.value` updates the DOM only and submits an empty
  //    form. This used to be a third private copy of that mechanism.
  let typed = 'ok'
  for (const [field, value] of [
    ['host', host],
    ['username', username],
    ['password', password],
  ] as const) {
    const result = String(await run(FILL(field, value)))
    if (result !== 'ok') {
      typed = result
      break
    }
  }
  // Deliberately not recording what was typed — only whether the fields existed.
  observed['fillCredentials'] = typed
  if (typed !== 'ok') {
    failures.push(`sign-in form incomplete: ${typed}`)
    return { name: resultName, ok: false, observed, failures }
  }

  await sleep(300)
  const submitted = String(await run(SUBMIT_SIGN_IN))
  observed['submit'] = submitted
  if (submitted !== 'ok') {
    failures.push('the sign-in form could not be submitted')
    return { name: resultName, ok: false, observed, failures }
  }

  // Measured elapsed time, not the sum of the sleeps: each check is an `executeJavaScript`
  // round-trip, and counting only the quanta under-reports the sign-in by exactly the time
  // the app took to answer.
  const signIn = await pollUntil(signedIn, SIGN_IN_BUDGET_MS, POLL_MS)
  observed['signInMs'] = String(signIn.elapsedMs)

  if (!signIn.ok) {
    // The screen is part of the failure. "Sign-in did not complete" without the rendered
    // text sends the reader looking in the wrong component.
    observed['screen'] = String(await run(`(document.body.innerText || '').slice(0, 2000)`))
    failures.push(`no session after ${signIn.elapsedMs} ms over ${host}; see observed.screen`)
    observed['screenshot'] = await capturePng(
      window,
      join(dirname(reportPath), `${resultName}-failed.png`),
    )
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

  observed['screenshot'] = await capturePng(
    window,
    join(dirname(reportPath), `${resultName}-signed-in.png`),
  )

  // 6. Having a session is not having a working app. The tour clicks all four sections and
  //    asserts on what they rendered — over this tunnel, with this session.
  const tour = await runTour(window, reportPath)
  for (const [key, value] of Object.entries(tour.observed)) observed[`tour.${key}`] = value
  failures.push(...tour.failures.map((f) => `tour: ${f}`))

  // A step that threw is a finding of its own — it means a read did not happen, so every
  // assertion depending on it was made on a missing value rather than on a measurement.
  failures.push(...failed.map((note) => `a step could not run — ${note}`))

  return { name: resultName, ok: failures.length === 0, observed, failures }
}
