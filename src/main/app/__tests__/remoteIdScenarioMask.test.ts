import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Kit from '../scenarioKit'

/**
 * The Remote ID scenario promised the id is "never stored" — and then photographed it.
 *
 * Measured 2026-10-28: `remote-id.png` and the report's `report.png` showed the id in the
 * input field, and on a failed join a second time in the error text ("network <id> is …");
 * `observed.screen` in report.json carried the same text. The id is the key to the device's
 * network, so the scenario masks it on screen BEFORE the first capture and strips it from
 * the text it reports.
 */

const ID = '0123456789abcdef'
let events: string[] = []

vi.mock('../scenarioKit', async (original) => ({
  ...(await original<typeof Kit>()),
  sleep: async (): Promise<void> => {},
  pollUntil: async (): Promise<{ ok: boolean; elapsedMs: number }> => ({ ok: true, elapsedMs: 1 }),
  waitForResumeSettled: async (): Promise<{ phase: string; elapsedMs: number }> => ({ phase: 'done', elapsedMs: 0 }),
  capturePng: async (): Promise<string> => {
    events.push('capture')
    return 'shot.png'
  },
}))

/** A window whose page shows the id the way a failed join does: in the field and in the error. */
const fakeWindow = () => ({
  webContents: {
    // The throw-away capture: in memory only, it must not reach `capturePng` (a file).
    capturePage: async (): Promise<unknown> => {
      events.push('capture-in-memory')
      return {}
    },
    executeJavaScript: async (script: string): Promise<unknown> => {
      if (script.includes('text-security')) {
        events.push('mask')
        return 'ok'
      }
      if (script.includes('hasPasswordField')) {
        return { text: `Remote ID\nnetwork ${ID} is REQUESTING_CONFIGURATION`, hasPasswordField: false, signedIn: false }
      }
      return 'ok'
    },
  },
})

beforeEach(() => {
  events = []
  process.env['ZIMA_VERIFY_STARTUP'] = '/nonexistent/report.json'
})
afterEach(() => {
  delete process.env['ZIMA_VERIFY_STARTUP']
})

describe('remote-id scenario', () => {
  it('masks the id on screen before the first capture', async () => {
    const { runScenario } = await import('../scenarios')
    await runScenario(fakeWindow() as never, 'remote-id', ID)
    // Order measured to matter: mask, then one capture thrown away (capturePage returns the
    // previous frame), then the one written to disk.
    expect(events).toEqual(['mask', 'capture-in-memory', 'capture'])
  })

  it('reports the screen without the id', async () => {
    const { runScenario } = await import('../scenarios')
    const result = await runScenario(fakeWindow() as never, 'remote-id', ID)
    expect(JSON.stringify(result)).not.toMatch(/[0-9a-f]{16}/i)
    // The rest of the error stays readable — it is the diagnosis.
    expect(result.observed['screen']).toContain('REQUESTING_CONFIGURATION')
  })
})
