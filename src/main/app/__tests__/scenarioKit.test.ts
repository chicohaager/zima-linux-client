import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  capturePng,
  CLICK_ACTION,
  pollUntil,
  SIGNED_IN,
  SUBMIT_SIGN_IN,
  waitForResumeSettled,
  withDeadline,
} from '../scenarioKit'

/**
 * The scenario primitives, and the four failures they exist to prevent.
 *
 * Every case here corresponds to a way the VERIFIER produced a false verdict about a working
 * app — the most expensive kind of defect this project has, because it sends people to repair
 * code that works.
 */

describe('pollUntil', () => {
  it('reports the measured elapsed time, not the sum of its sleeps', async () => {
    // Each check costs real time, like an executeJavaScript round-trip does. A loop that only
    // adds up its sleep quanta reports less than it actually waited — that was `signInMs`.
    let calls = 0
    const outcome = await pollUntil(
      async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 40))
        return calls >= 3
      },
      5_000,
      10,
    )

    expect(outcome.ok).toBe(true)
    // Three checks at ~40 ms plus two sleeps of 10 ms — a quanta-only count would say 20.
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(100)
  })

  it('gives up at the budget and says how long it waited', async () => {
    const outcome = await pollUntil(async () => false, 120, 20)

    expect(outcome.ok).toBe(false)
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(120)
  })

  it('checks once before sleeping, so an already-true condition costs nothing', async () => {
    const outcome = await pollUntil(async () => true, 10_000, 5_000)

    expect(outcome.ok).toBe(true)
    expect(outcome.elapsedMs).toBeLessThan(1_000)
  })
})

describe('withDeadline', () => {
  it('resolves to null when the work never returns', async () => {
    // The measured failure: `capturePage()` that never resolves. Unbounded, the caller hangs
    // where no try/catch can see it and the watchdog reports a timeout for a completed run.
    const never = new Promise<string>(() => {})
    expect(await withDeadline(never, 30)).toBeNull()
  })

  it('passes the value through when the work wins the race', async () => {
    expect(await withDeadline(Promise.resolve('shot'), 5_000)).toBe('shot')
  })
})

describe('capturePng', () => {
  const windowWith = (capture: () => Promise<{ toPNG: () => Buffer }>): BrowserWindow =>
    ({ webContents: { capturePage: capture } }) as unknown as BrowserWindow

  it('returns a note instead of hanging when the capture stalls', async () => {
    const stalled = windowWith(() => new Promise(() => {}))

    const note = await capturePng(stalled, '/tmp/does-not-matter.png', 25)

    expect(note).toContain('did not return within 25 ms')
  })

  it('writes the file and returns its path on success', async () => {
    const path = `/tmp/zima-capture-test-${process.pid}.png`
    const shot = windowWith(async () => ({ toPNG: () => Buffer.from('PNG-bytes') }))

    expect(await capturePng(shot, path)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('PNG-bytes')
  })

  it('reports a write failure rather than throwing it at the caller', async () => {
    const shot = windowWith(async () => ({ toPNG: () => Buffer.from('x') }))

    const note = await capturePng(shot, '/this/directory/does/not/exist/x.png')

    expect(note).toContain('capture written nowhere')
  })
})

describe('the scripts scenarios inject', () => {
  /**
   * 🔴 Detection must never depend on a translation.
   *
   * Reading "Abmelden" / "Sign out" is correct in 2 of 28 catalogues; in the other 26 the
   * check misses and a working session is reported as "never signed in".
   */
  it('detects a session by attribute, not by any translated word', () => {
    expect(SIGNED_IN).toContain('[data-action="sign-out"]')
    expect(SIGNED_IN).not.toMatch(/Abmelden|Sign out|innerText/)
  })

  it('clicks by data-action rather than by button text', () => {
    const script = CLICK_ACTION('direct-ip')

    expect(script).toContain('data-action=')
    expect(script).toContain('missing-action:direct-ip')
    expect(script).not.toContain('textContent')
  })

  it('submits the form that owns the password field, without reading a label', () => {
    expect(SUBMIT_SIGN_IN).toContain('requestSubmit')
    expect(SUBMIT_SIGN_IN).not.toMatch(/Anmelden|Sign in/)
  })
})

describe('waitForResumeSettled', () => {
  it('waits for a terminal phase instead of a fixed sleep', async () => {
    const phases = ['idle', 'running', 'running', 'done']
    const read = vi.fn(async () => phases.shift() ?? 'done')

    const settled = await waitForResumeSettled(read, 5_000)

    expect(settled.phase).toBe('done')
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  for (const terminal of ['done', 'nothing-stored', 'failed']) {
    it(`treats "${terminal}" as settled`, async () => {
      const settled = await waitForResumeSettled(async () => terminal, 1_000)
      expect(settled.phase).toBe(terminal)
    })
  }

  it('does not wait out the budget on a screen that never publishes the marker', async () => {
    // `absent` is the honest answer for a scenario that starts somewhere else — waiting for a
    // marker that is never coming would spend the whole budget and then report a stall.
    const settled = await waitForResumeSettled(async () => 'absent', 10_000)

    expect(settled.phase).toBe('absent')
    expect(settled.elapsedMs).toBeLessThan(1_000)
  })

  it('says the restore was still running when the budget runs out', async () => {
    const settled = await waitForResumeSettled(async () => 'running', 60)

    expect(settled.phase).toContain('running')
    expect(settled.phase).toContain('still running')
  })
})
