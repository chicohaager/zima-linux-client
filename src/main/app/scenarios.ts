import type { BrowserWindow } from 'electron'

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Types into a labelled input and dispatches the events React listens for. */
const FILL = (name: string, value: string): string => `(() => {
  const input = document.querySelector('input[name="${name}"]')
  if (!input) return 'missing:${name}'
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

const CLICK_TEXT = (text: string): string => `(() => {
  const target = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim().startsWith(${JSON.stringify(text)}),
  )
  if (!target) return 'missing-button'
  target.click()
  return 'ok'
})()`

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

  observed['openForm'] = await run(CLICK_TEXT('Über IP-Adresse verbinden'))
  await sleep(400)

  observed['fillHost'] = await run(FILL('host', host))
  observed['fillUser'] = await run(FILL('username', 'zima-client-verify-nonexistent'))
  observed['fillPassword'] = await run(FILL('password', 'not-a-real-password'))
  await sleep(200)

  observed['submit'] = await run(CLICK_TEXT('Anmelden'))
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
