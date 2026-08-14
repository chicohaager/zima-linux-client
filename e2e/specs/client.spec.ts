import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { FAKE_HOST, credentials, startFakeDevice, type FakeDevice } from '../fake-device.mjs'

/**
 * The must-go flows, clicked in the real window of the real build.
 *
 * What each assertion is FOR, since a test suite that nobody can read is a suite nobody
 * maintains:
 *
 *  - "no raw i18n key on screen" — the class of defect that passes type-check, lint, unit
 *    tests and the build gate, and is obvious to any user.
 *  - counts, never mere presence — "the list is there" is also true of an empty one, and an
 *    empty list is exactly what a broken request renders.
 *  - the WRONG-password path, asserted on the rendered sentence — ZimaOS answers 400, the
 *    same status its files API uses for "invalid path", and this app once told users their
 *    path was rejected when their password was wrong.
 *  - a non-German locale, because the German strings are the ones that get looked at.
 */

let fake: FakeDevice

test.beforeAll(async () => {
  fake = await startFakeDevice()
})

test.afterAll(async () => {
  await fake.stop()
})

interface Launched {
  readonly app: ElectronApplication
  readonly page: Page
  readonly userDataDir: string
}

/**
 * Starts the built app with its own profile.
 *
 * A fresh profile per test on purpose: a stored session from a previous test would let the
 * next one pass without signing in, and the suite would be green about state it created
 * itself rather than about the flow it claims to cover.
 */
const launch = async (): Promise<Launched> => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'zima-e2e-'))
  const app = await electron.launch({
    args: [
      'out/main/index.js',
      `--user-data-dir=${userDataDir}`,
      // Passing the flag in argv is also what SUPPRESSES the relaunch: `decidePlatform`
      // treats an argv that already carries it as settled, so the process Playwright is
      // holding on to is the one that stays. Without it, a Wayland host with a risky driver
      // would spawn a detached replacement and the handle would go dead.
      '--ozone-platform=x11',
      '--no-sandbox',
    ],
    env: { ...process.env },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir }
}

const close = async ({ app, userDataDir }: Launched): Promise<void> => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
}

/** Raw i18n keys as they would appear if a translation were missing: `device.title`. */
const RAW_KEY = /(?:^|\s)(?:device|files|photos|apps|signIn|error|zerotier|tailscale)\.[a-z][A-Za-z]+/

const signIn = async (page: Page, password = credentials.password): Promise<void> => {
  await page.click('[data-action="direct-ip"]')
  await page.fill('input[name="host"]', FAKE_HOST)
  await page.fill('input[name="username"]', credentials.username)
  await page.fill('input[name="password"]', password)
  await page.locator('input[name="password"]').press('Enter')
}

test('starts and renders the device screen without raw translation keys', async () => {
  const launched = await launch()
  try {
    await expect(launched.page.locator('nav button[data-nav="device"]')).toBeVisible()
    const text = await launched.page.locator('body').innerText()
    expect(text).not.toMatch(RAW_KEY)
    expect(text.length).toBeGreaterThan(50)
  } finally {
    await close(launched)
  }
})

test('a wrong password is reported as a wrong password, not as a rejected path', async () => {
  const launched = await launch()
  try {
    await signIn(launched.page, 'wrong-on-purpose')
    // The German sentence, because that is what the user reads. The failure this guards
    // against renders a grammatically fine sentence about a path.
    await expect(launched.page.getByText('Benutzername oder Passwort ist falsch.')).toBeVisible()
    const text = await launched.page.locator('body').innerText()
    expect(text).not.toContain('lehnt diesen Pfad ab')
    expect(text).not.toMatch(RAW_KEY)
  } finally {
    await close(launched)
  }
})

test('signing in loads files, photos and apps with real content', async () => {
  const launched = await launch()
  const { page } = launched
  try {
    await signIn(page)
    await expect(page.locator('[data-action="sign-out"]')).toBeVisible({ timeout: 30_000 })

    await page.click('nav button[data-nav="files"]')
    // 80 entries were recorded; asserting "more than a handful" keeps the test honest when
    // the fixture is re-recorded, while still failing on the empty list a broken request
    // would render.
    await expect.poll(async () => page.locator('li').count(), { timeout: 30_000 }).toBeGreaterThan(10)

    await page.click('nav button[data-nav="photos"]')
    await expect.poll(async () => page.locator('img').count(), { timeout: 30_000 }).toBeGreaterThan(10)

    await page.click('nav button[data-nav="apps"]')
    await expect.poll(async () => page.locator('section').count(), { timeout: 30_000 }).toBeGreaterThan(5)

    // Images the renderer asked for and did not get. Grey squares are invisible to every
    // assertion that only counts elements.
    const broken = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('img')).filter(
          (img) => img.complete && img.naturalWidth === 0,
        ).length,
    )
    expect(broken).toBe(0)

    for (const section of ['device', 'files', 'photos', 'apps']) {
      await page.click(`nav button[data-nav="${section}"]`)
      const text = await page.locator('body').innerText()
      expect(text, `raw i18n key visible on the ${section} screen`).not.toMatch(RAW_KEY)
      expect(text, `an error state is showing on the ${section} screen`).not.toContain(
        'Da ist etwas schiefgegangen',
      )
    }

    // Asked of the fake itself, in the same test rather than in a later one: a port that
    // answers is not proof that the server this suite started is the one answering. It lives
    // here because a separate test would depend on this one having run first, and Playwright
    // restarts its worker after a failure — the standalone version reported "the client
    // never talked to the fake" when the truth was "the fake was restarted underneath it".
    const served = await fake.served()
    expect(served).toContain('POST /v1/users/login')
    expect(served).toContain('GET /v1/gateway/routes')
  } finally {
    await close(launched)
  }
})

/**
 * 🔴 The half of the Photos tab that nothing covered.
 *
 * `capabilities.ts` promises that browsing and backup do NOT need the photos module — they go
 * through the files API — so a device without it gets the folder grid. That promise had never
 * been executed anywhere: the recording HAS `/v2/photos`, so every test, every screenshot and
 * the by-hand walk on Zorin ran the library mode. A tester on Fedora ran the other half on
 * 2026-08-11 and got `The device rejects this path (HTTP 400)` instead of his pictures.
 *
 * This test does NOT reproduce his 400 — its cause is still unmeasured (his volume, or the
 * `sort=modified` / `size=300` that only this tab sends). It asserts the promise itself, on
 * the device sort that was missing from the test world: no module, and pictures on screen.
 */
test('a device without the photos module shows the folder grid, not an error', async () => {
  await fake.without(['/v2/photos'])
  const before = (await fake.served()).length
  const launched = await launch()
  const { page } = launched
  try {
    await signIn(page)
    await expect(page.locator('[data-action="sign-out"]')).toBeVisible({ timeout: 30_000 })
    await page.click('nav button[data-nav="photos"]')

    // The named explanation, not an empty gallery. This is the part the forum thread was
    // right about.
    await expect(page.getByText('Die Fotosuche braucht das Photos-Modul')).toBeVisible()

    // And the part it was wrong about: 38 of the 80 recorded entries are pictures or videos,
    // so a working folder grid renders tiles. "More than 20" survives a re-recording; zero is
    // exactly what the reported defect looks like.
    await expect.poll(async () => page.locator('img').count(), { timeout: 30_000 }).toBeGreaterThan(20)

    const text = await page.locator('body').innerText()
    expect(text, 'the folder grid reported a rejected path').not.toContain('lehnt diesen Pfad ab')
    expect(text).not.toContain('Da ist etwas schiefgegangen')
    expect(text).not.toMatch(RAW_KEY)

    const broken = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('img')).filter(
          (img) => img.complete && img.naturalWidth === 0,
        ).length,
    )
    expect(broken).toBe(0)

    // What the client asked the device for, from this test's own slice of the log: the files
    // API yes, the absent module never. Asking a route the gateway does not have would be a
    // defect the screen might not show — the fake answers those 404 by GUESS, and this
    // assertion is what keeps the guess from mattering.
    const mine = (await fake.served()).slice(before)
    expect(mine).toContain('GET /v2_1/files/file')
    expect(mine.filter((line) => line.includes('/v2/photos'))).toEqual([])
  } finally {
    await fake.without([])
    await close(launched)
  }
})

test('switching the language renders translated text, not keys or English', async () => {
  const launched = await launch()
  const { page } = launched
  try {
    // Switched by CLICKING the menu, which is the only route a user has.
    //
    // 🔴 The first version of this test set ZIMA_VERIFY_LOCALE and asserted on the result.
    // That variable is read only by the startup verifier, which does not run here — so the
    // app stayed German and the test failed for a reason that had nothing to do with
    // translation. An environment variable I assumed was a product setting was a verifier
    // setting.
    await page.click('[data-action="language-menu"]')
    await page.click('button[data-locale="ja_JP"]')

    await expect
      .poll(async () => page.locator('body').innerText(), { timeout: 15_000 })
      // Japanese script has to be on screen. An English fallback would leave this empty
      // while every structural assertion still passed — which is exactly the failure mode
      // a "the app still renders" check cannot see.
      .toMatch(/[぀-ヿ一-龯]/)

    const text = await page.locator('body').innerText()
    expect(text).not.toMatch(RAW_KEY)
    // German must be GONE, not merely joined: a half-switched UI reads as a broken one.
    expect(text).not.toContain('Lokales Netzwerk durchsuchen')
  } finally {
    await close(launched)
  }
})

/*
 * NICHT hier: ein E2E-Fall für die Karte "Ist das dein Gerät?".
 *
 * Versucht am 2026-08-10 und als undurchführbar gemessen, damit es niemand ein zweites Mal
 * versucht. Der Fall braucht eine GESPEICHERTE Sitzung, deren Weg dann stirbt. In dieser
 * Umgebung gibt es keinen Schlüsselbund, und `safeStorage.encryptString` scheitert — im Log
 * der Testinstanz nachgelesen:
 *
 *     session.refresh-token-not-persisted {"id":"host:127.0.0.1","kind":"internal"}
 *     session.signed-in {... "persisted":false}
 *
 * Ohne gespeicherten Token meldet der zweite Start "nichts gespeichert" statt eines
 * fehlgeschlagenen Fortsetzens — ein anderer Zustand als der gesuchte. Die Einwilligung zum
 * Klartext-Backend zu geben ändert daran nichts: sie erlaubt das Schreiben, sie repariert
 * nicht die fehlende Verschlüsselung.
 *
 * Was den Fall stattdessen abdeckt: `devices/__tests__/rediscover.test.ts` (Erkennung und
 * die drei Fälle, in denen NICHT übernommen werden darf) und
 * `ipc/__tests__/devicePaths.test.ts` (die beiden Kanäle). Was dort nicht abgedeckt ist und
 * ehrlich offen bleibt: ob die Karte im laufenden Fenster erscheint.
 */
