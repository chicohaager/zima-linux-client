import { dirname, join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { capturePng, CLICK_ACTION, FILL, SIGNED_IN, sleep, SUBMIT_SIGN_IN } from './scenarioKit'
import { runTour } from './tourScenario'
import { runTailscaleSignIn } from './tailscaleSignInScenario'

/**
 * Scripted UI scenarios for the startup verifier.
 *
 * These drive the real window of the real build and read back what was *rendered* — the
 * level at which HTTP 200 checks and green unit tests are blind: raw i18n keys, English
 * text in a German session, an error mapped to the wrong message.
 *
 * Enabled with ZIMA_VERIFY_SCENARIO=<name>:<argument>.
 */

export interface ScenarioResult {
  readonly name: string
  readonly ok: boolean
  readonly observed: Readonly<Record<string, string>>
  readonly failures: readonly string[]
}

const VISIBLE_TEXT = `(document.body.innerText || '').trim()`

/**
 * Signs in against a real device with a username that does not exist, and asserts the
 * rendered German error.
 *
 * Why a nonexistent user: it exercises the full chain — form, IPC, HTTP, the ZimaOS
 * envelope, the error mapping and the translation — without sending failed attempts at a
 * real account. The happy path still needs a credential and is NOT covered here.
 *
 * The assertion is deliberately about the *rendered* message. ZimaOS answers a wrong
 * password with HTTP 400 and code 10013; a status-only mapping would render "the device
 * rejects this path", which is what this scenario would catch.
 */
const signInWrongPassword = async (
  window: BrowserWindow,
  host: string,
): Promise<ScenarioResult> => {
  const failures: string[] = []
  const observed: Record<string, string> = { host }
  const run = async (script: string): Promise<string> =>
    String(await window.webContents.executeJavaScript(script, true))

  // Clicked by its `data-action`, not by its German label. The label works in exactly one
  // of 28 catalogues; every other ZIMA_VERIFY_LOCALE turned this into `missing-button` and
  // reported a working app as broken — the same defect the tour already fixed with data-nav.
  observed['openForm'] = await run(CLICK_ACTION('direct-ip'))
  await sleep(400)

  observed['fillHost'] = await run(FILL('host', host))
  observed['fillUser'] = await run(FILL('username', 'zima-client-verify-nonexistent'))
  observed['fillPassword'] = await run(FILL('password', 'not-a-real-password'))
  await sleep(200)

  observed['submit'] = await run(SUBMIT_SIGN_IN)
  // Give the device time to answer; the login endpoint replied in well under a second
  // when measured, so three seconds is generous rather than hopeful.
  await sleep(3_000)

  const text = await run(VISIBLE_TEXT)
  observed['rendered'] = text.slice(0, 500)

  for (const [key, value] of Object.entries(observed)) {
    if (value.startsWith('missing')) failures.push(`${key} -> ${value}`)
  }

  const expected = 'Benutzername oder Passwort ist falsch.'
  if (!text.includes(expected)) {
    failures.push(`rendered text does not contain the German credential error: "${expected}"`)
  }
  // The wrong mapping this guards against, named explicitly so a regression is obvious.
  if (text.includes('lehnt diesen Pfad ab')) {
    failures.push('HTTP 400 was mapped to "invalid path" instead of "wrong credentials"')
  }
  if (/\b(?:error|signIn|devices)\.[a-z]/i.test(text)) {
    failures.push('a raw i18n key is visible in the rendered output')
  }

  return { name: 'signin-wrong-password', ok: failures.length === 0, observed, failures }
}

/**
 * Dumps the raw IPC answer of a sign-in attempt.
 *
 * A diagnostic scenario: when the UI shows a generic error, this says whether the wrong
 * mapping happened in the main process or in the renderer.
 */
const signInIpcDump = async (window: BrowserWindow, host: string): Promise<ScenarioResult> => {
  const observed: Record<string, string> = { host }
  const run = async (label: string, script: string): Promise<string> => {
    try {
      const value = await window.webContents.executeJavaScript(script, true)
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      observed[label] = String(text).slice(0, 600)
    } catch (cause) {
      // Each step reports its own failure, so the report names WHICH step broke instead
      // of just "the script failed".
      observed[label] = `threw: ${String(cause).slice(0, 200)}`
    }
    return observed[label] ?? ''
  }

  await run('bridgePresent', `typeof window.zima`)
  await run('bridgeKeys', `Object.keys(window.zima).join(',')`)
  const raw = await run(
    'signInResponse',
    `window.zima.signIn({host:${JSON.stringify(host)},port:80,kind:'direct',username:'zima-client-verify-nonexistent',password:'not-a-real-password'})`,
  )

  const matched = raw.includes('invalid-credentials')
  return {
    name: 'signin-ipc-dump',
    ok: matched,
    observed,
    failures: matched ? [] : [`IPC did not report invalid-credentials (see observed.signInResponse)`],
  }
}

/**
 * Clicks the Remote-ID route the way a user does — button, field, submit — and reports what
 * the screen said.
 *
 * The ID is passed in at run time (`ZIMA_VERIFY_SCENARIO=remote-id:<id>`) and never stored:
 * it identifies someone's device and has no business in a repository.
 *
 * This exists because the alternative was to test the daemon's argument form by hand and
 * then claim the route works — measuring the part I could reach instead of the part being
 * claimed. The ZeroTier daemon had been exiting instantly on a malformed `-p 9997`, and no
 * amount of checking that `-p9997` runs in a shell would have proven that THIS code passes
 * it correctly.
 */
const remoteIdScenario = async (
  window: BrowserWindow,
  remoteId: string,
): Promise<ScenarioResult> => {
  const failures: string[] = []
  const observed: Record<string, string> = {}
  const run = async (script: string): Promise<unknown> =>
    window.webContents.executeJavaScript(script, true)

  await new Promise((resolve) => setTimeout(resolve, 3_000))

  const clicked = String(
    await run(`(() => {
      const wanted = ${JSON.stringify('Über Remote-ID verbinden')}
      const button = Array.from(document.querySelectorAll('button'))
        .find((b) => (b.textContent || '').trim() === wanted)
      if (!button) return 'missing-button'
      button.click()
      return 'ok'
    })()`),
  )
  observed['openPanel'] = clicked
  if (clicked !== 'ok') {
    return { name: 'remote-id', ok: false, observed, failures: ['the Remote-ID button was not found'] }
  }

  await new Promise((resolve) => setTimeout(resolve, 600))

  // Typed through the native value setter so React's onChange actually fires — assigning
  // `.value` directly updates the DOM and leaves React's state untouched, which would
  // submit an empty form and look like a validation bug.
  const filled = String(
    await run(`(() => {
      const input = document.querySelector('input[name="remoteId"]')
      if (!input) return 'missing-input'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(remoteId)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`),
  )
  observed['fillField'] = filled
  if (filled !== 'ok') {
    return { name: 'remote-id', ok: false, observed, failures: ['the Remote-ID field was not found'] }
  }

  await new Promise((resolve) => setTimeout(resolve, 400))
  const submitted = String(
    await run(`(() => {
      const form = document.querySelector('input[name="remoteId"]').closest('form')
      if (!form) return 'missing-form'
      form.requestSubmit()
      return 'ok'
    })()`),
  )
  observed['submit'] = submitted

  // Joining a network and probing takes real time on a real tunnel.
  await new Promise((resolve) => setTimeout(resolve, 25_000))

  /*
   * 🔴 `signedIn` is read from the attribute, not from the button's text.
   *
   * It used to match the literals 'Abmelden' / 'Sign out', which are correct in 2 of the 28
   * catalogues. With any other ZIMA_VERIFY_LOCALE — and a stored session resuming straight
   * to the signed-in screen, which is the case this branch exists for — both matches miss,
   * no password field is present either, and the scenario reports "neither the sign-in form
   * nor a signed-in session was reached" for a route that worked.
   */
  const after = (await run(`(() => ({
    text: document.body.innerText || '',
    hasPasswordField: document.querySelector('input[type="password"]') !== null,
    signedIn: ${SIGNED_IN},
  }))()`)) as { text: string; hasPasswordField: boolean; signedIn: boolean }

  observed['screen'] = after.text.slice(0, 1500)
  observed['reachedSignIn'] = String(after.hasPasswordField)
  observed['signedIn'] = String(after.signedIn)

  /*
   * Either outcome proves the route: everything before it — daemon with a working network
   * device, join, address derivation, probe — had to succeed for the client to get this far.
   *
   * 🔴 The second case was added after this check failed on a run where the route WORKED:
   * a stored session resumed straight through to the signed-in screen, so no password field
   * ever appeared and the scenario called the success a failure. A gate that goes red on a
   * good outcome gets ignored, which costs more than the check is worth.
   */
  if (!after.hasPasswordField && !after.signedIn) {
    failures.push('neither the sign-in form nor a signed-in session was reached; see observed.screen')
  }

  /*
   * 🔴 The same defect the tour had, two functions away: `?? 'report.json'` makes `dirname`
   * return `.`, and the screenshot lands in the current working directory — which is the
   * repository when this is run from a checkout. The tour's version put four PNGs of a real
   * tailnet into a commit on 2026-07-31. Fixed there and, at the time, not here: a sibling
   * inherits the bug as readily as it inherits the assumption.
   *
   * No fallback now. A screenshot with nowhere to go is not written, and the report says so.
   */
  const reportDir = process.env['ZIMA_VERIFY_STARTUP']
  if (reportDir === undefined || reportDir.length === 0) {
    observed['screenshot'] = 'not written — ZIMA_VERIFY_STARTUP names no report path'
  } else {
    // Bounded, like every other capture in this codebase: `capturePage()` can never return
    // (measured 2026-07-31 on the packaged payload), and an unbounded await here would hang
    // the scenario where its own caller cannot see it.
    observed['screenshot'] = await capturePng(window, join(dirname(reportDir), 'remote-id.png'))
  }

  return { name: 'remote-id', ok: failures.length === 0, observed, failures }
}

export const parseScenario = (): { name: string; argument: string } | null => {
  const raw = process.env['ZIMA_VERIFY_SCENARIO']
  if (raw === undefined || raw.length === 0) return null
  const separator = raw.indexOf(':')
  return separator === -1
    ? { name: raw, argument: '' }
    : { name: raw.slice(0, separator), argument: raw.slice(separator + 1) }
}

export const runScenario = async (
  window: BrowserWindow,
  name: string,
  argument: string,
): Promise<ScenarioResult> => {
  switch (name) {
    case 'signin-wrong-password':
      return signInWrongPassword(window, argument)
    case 'signin-ipc-dump':
      return signInIpcDump(window, argument)
    case 'remote-id':
      return remoteIdScenario(window, argument)
    case 'direct-signin':
    case 'tailscale-signin': {
      // Same report-path rule as the tour below: no working-directory default, because that
      // once put screenshots of a real tailnet into a commit.
      const path = process.env['ZIMA_VERIFY_STARTUP'] ?? ''
      if (path.length === 0) {
        return {
          name,
          ok: false,
          observed: {},
          failures: [`${name}: set ZIMA_VERIFY_STARTUP so screenshots have a home`],
        }
      }
      return runTailscaleSignIn(
        window,
        argument,
        path,
        name === 'tailscale-signin' ? 'tailscale-panel' : 'direct-ip',
      )
    }
    case 'tour': {
      // The argument is the report path, so the tour can put its screenshots beside it.
      //
      // 🔴 Without this fallback an empty argument became `dirname('')` === '.', and the
      // tour wrote four PNGs into the current directory — measured 2026-07-31: they landed
      // in the repository root and were committed, showing a real tailnet with peer
      // addresses. A default that quietly picks the working directory turns a forgotten
      // argument into files where nobody looks for them.
      const path = argument.length > 0 ? argument : (process.env['ZIMA_VERIFY_STARTUP'] ?? '')
      if (path.length === 0) {
        return {
          name,
          ok: false,
          observed: {},
          failures: [
            'tour: no report path — pass ZIMA_VERIFY_SCENARIO=tour:<path> or set ZIMA_VERIFY_STARTUP',
          ],
        }
      }
      return runTour(window, path)
    }
    default:
      // An unknown scenario name is a failure, not a silent pass. A verifier that
      // reports success for a scenario it never ran is worse than no verifier.
      return {
        name,
        ok: false,
        observed: {},
        failures: [`unknown scenario "${name}"`],
      }
  }
}
