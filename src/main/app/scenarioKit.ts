import { writeFile } from 'node:fs/promises'
import type { BrowserWindow } from 'electron'

/**
 * The primitives every scripted scenario needs, in one place.
 *
 * They live in their own module rather than in `scenarios.ts` because that file imports
 * `runTailscaleSignIn`, and the sign-in scenario imports back from it. Today that cycle is
 * type-only and erased at build time; moving runtime helpers across it would make it real.
 *
 * Why these five and not a general "utils": each one replaces a copy that had already
 * drifted, or a pattern this project has been burned by.
 *
 *  - `sleep` existed three times, byte-identical.
 *  - `pollUntil` existed twice in one file in two different shapes (a for-loop and a
 *    while-loop), which is how a fix to one silently misses the other. It also returns the
 *    MEASURED elapsed time, because the while-loop reported the sum of its sleep quanta as
 *    "signInMs" — a number that ignores the round-trip it spent inside every check.
 *  - `FILL` existed three times: here, in `scenarios.ts`, and inline in the sign-in scenario.
 *  - `capturePng` is the one with a history: `capturePage()` can never return (measured
 *    2026-07-31 on the packaged payload), and a scenario awaiting it unbounded hangs inside
 *    its caller where no try/catch can see it — the watchdog then reports a timeout for a run
 *    that had already done its work. `startupVerification.ts` learned that and races its own
 *    capture; the scenarios have to do the same, so the deadline belongs here.
 *  - `CLICK_ACTION` is the locale-independent click. Clicking a button by its German label
 *    turns every other language into a red verification of a working app.
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface PollOutcome {
  readonly ok: boolean
  /** Wall-clock time actually spent, not the sum of the sleeps. */
  readonly elapsedMs: number
}

/**
 * Waits until `check` answers true, or the budget runs out.
 *
 * The predicate is awaited, so its own round-trip counts against the budget — that is the
 * point. `executeJavaScript` against a busy renderer is not free, and a loop that only adds
 * up its `sleep` calls under-reports by exactly the time the app took to answer.
 */
export const pollUntil = async (
  check: () => Promise<boolean>,
  budgetMs: number,
  pollMs = 500,
): Promise<PollOutcome> => {
  const started = Date.now()
  for (;;) {
    if (await check()) return { ok: true, elapsedMs: Date.now() - started }
    if (Date.now() - started >= budgetMs) return { ok: false, elapsedMs: Date.now() - started }
    await sleep(pollMs)
  }
}

/** Resolves to `null` instead of waiting forever. The loser of the race is abandoned. */
export const withDeadline = <T>(work: Promise<T>, limitMs: number): Promise<T | null> => {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs)
  })
  return Promise.race([work, deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** Default deadline for a screenshot. Generous; it exists to bound a hang, not to hurry. */
export const CAPTURE_MS = 15_000

/**
 * Screenshots the window, and says so in words when it could not.
 *
 * Returns the note for the report rather than throwing: a missing screenshot must not cost
 * the measurements that were already taken.
 */
export const capturePng = async (
  window: BrowserWindow,
  path: string,
  limitMs = CAPTURE_MS,
): Promise<string> => {
  const shot = await withDeadline(window.webContents.capturePage(), limitMs)
  if (shot === null) return `capture did not return within ${limitMs} ms`
  try {
    await writeFile(path, shot.toPNG())
    return path
  } catch (cause) {
    return `capture written nowhere: ${String(cause).slice(0, 120)}`
  }
}

/** Types into a labelled input and dispatches the events React listens for. */
export const FILL = (name: string, value: string): string => `(() => {
  const input = document.querySelector('input[name="${name}"]')
  if (!input) return 'missing:${name}'
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(value)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`

/**
 * Clicks the control carrying `data-action="<action>"`.
 *
 * Locale-independent on purpose. The label-based click it replaces reported
 * `missing-button` on every language but the one it was written in, which is a red
 * verification of a working app — and a gate that goes red on good outcomes gets ignored.
 */
export const CLICK_ACTION = (action: string): string => `(() => {
  const target = document.querySelector('[data-action=' + ${JSON.stringify(
    JSON.stringify(action),
  )} + ']')
  if (!target) return 'missing-action:${action}'
  target.click()
  return 'ok'
})()`

/** Submits the form owning the password field, without depending on the button's label. */
export const SUBMIT_SIGN_IN = `(() => {
  const input = document.querySelector('input[type="password"]')
  const form = input ? input.closest('form') : null
  if (!form) return 'missing-form'
  form.requestSubmit()
  return 'ok'
})()`

/** True while a session is signed in — read from the attribute, never from a translation. */
export const SIGNED_IN = `document.querySelector('[data-action="sign-out"]') !== null`

/**
 * Terminal states of the start-up session restore.
 *
 * `DeviceScreen` publishes `data-resume-phase`; `idle` and `running` mean the restore is
 * still in flight. Waiting for a terminal value replaces the fixed sleep that used to stand
 * here, which was a bet that a network round-trip finishes within 3.5 s — and when it lost,
 * the scenario recorded "started cold" for a run that was not cold, then blamed the sign-in
 * for the session the straggling restore had replaced underneath it.
 */
export const RESUME_PHASE = `(document.querySelector('[data-resume-phase]')
  ?.getAttribute('data-resume-phase') ?? 'absent')`

/**
 * `idle` counts as settled since 2026-08-10, when the automatic restore was removed: with
 * nothing running by itself, "the user has not asked yet" IS the terminal state at start.
 * Leaving it out would make every scenario wait out its full budget for an event that is
 * never coming — a waiter that turns a correct app into a timeout.
 */
const SETTLED = new Set(['idle', 'done', 'nothing-stored', 'failed'])

/**
 * Waits until the start-up restore has finished one way or another.
 *
 * `absent` counts as settled: the attribute only exists on the device screen, and a scenario
 * that starts elsewhere must not wait out the whole budget for a marker that is never coming.
 */
export const waitForResumeSettled = async (
  read: (script: string) => Promise<unknown>,
  budgetMs = 20_000,
): Promise<{ phase: string; elapsedMs: number }> => {
  let phase = 'idle'
  const outcome = await pollUntil(async () => {
    phase = String(await read(RESUME_PHASE))
    return SETTLED.has(phase) || phase === 'absent'
  }, budgetMs, 250)
  return { phase: outcome.ok ? phase : `${phase} (still running after ${budgetMs} ms)`, elapsedMs: outcome.elapsedMs }
}
