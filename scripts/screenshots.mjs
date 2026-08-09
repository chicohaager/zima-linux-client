/**
 * Takes the README screenshots from the real build, against the recorded device.
 *
 * Why a script and not a folder of hand-made pictures: a screenshot is a claim about what the
 * program shows, and a claim in this repository names the way it was produced. Anyone can run
 * this and get the same six images from the same build — that is the difference between
 * documentation and decoration.
 *
 * The device is `e2e/fixtures/zimaos-session.json`, the same recording the end-to-end suite
 * replays. It went through `e2e/scrub-fixture.mjs`, which replaces file and folder names
 * wholesale and rewrites private addresses, e-mail addresses and tokens. So these pictures
 * cannot show anyone's real files — not because someone remembered to check, but because the
 * only device involved has none.
 *
 * The interface is switched to English by CLICKING the language menu, and the narrow layout is
 * produced by starting the app at a narrow width — not by resizing an image and not by setting
 * a CSS class. `ZIMA_VERIFY_LOCALE` and `ZIMA_VERIFY_THEME` are deliberately not used here:
 * they are read by the startup verifier, which does not run under this launch, so setting them
 * would change nothing while looking like it had.
 *
 * Usage: npm run build && npm run screenshots
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { _electron as electron } from '@playwright/test'
import { FAKE_HOST, credentials, startFakeDevice } from '../e2e/fake-device.mjs'
import { findPrivate, isClean } from './screenshot-guard.mjs'

const OUT = 'docs/img'

/**
 * A PATH with no `tailscale` on it.
 *
 * 🔴 The reason, measured 2026-08-09 and nearly published: the first run of this script put
 * the author's real tailnet into the very first picture — its name, three peer hostnames and
 * their 100.x addresses. The recorded device covers what the DEVICE answers; the Tailscale
 * panel does not ask the device, it asks the local daemon, and that one is real. A recording
 * proves the provenance of what it recorded and of nothing else that shares the screen with it.
 *
 * `readRuntime()` resolves the binary through PATH and treats ENOENT as "not installed", which
 * is a normal state rather than an error — so removing it from PATH reaches the real code path
 * for a machine without Tailscale, which is the machine most readers have.
 */
const pathWithoutTailscale = () => {
  const dirs = (process.env['PATH'] ?? '').split(delimiter)
  return dirs.filter((dir) => dir !== '' && !existsSync(join(dir, 'tailscale'))).join(delimiter)
}

const launch = async (env = {}) => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'zima-shots-'))
  // 🔴 A home of its own, and not only a profile of its own.
  //
  // `--user-data-dir` moves Electron's storage; it does not move what the APP reads. The
  // "take over from the old client" panel scans `~/.config` for 0.9 installations and renders
  // every path it finds — user name included — next to the addresses those installations last
  // connected to. In the first run of this script that panel put three real paths and two real
  // addresses on the screen. An empty home makes the panel report what a reader's fresh machine
  // reports, which is also the honest picture.
  const home = mkdtempSync(join(tmpdir(), 'zima-shots-home-'))
  mkdirSync(join(home, '.config'), { recursive: true })
  const app = await electron.launch({
    args: [
      'out/main/index.js',
      `--user-data-dir=${userDataDir}`,
      // Same reason as in the e2e suite: an argv that already carries the platform flag is
      // what stops `decidePlatform` from relaunching a detached replacement and leaving this
      // handle pointing at a dead process.
      '--ozone-platform=x11',
      '--no-sandbox',
    ],
    env: {
      ...process.env,
      PATH: pathWithoutTailscale(),
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      ...env,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, userDataDir, home }
}

const close = async ({ app, userDataDir, home }) => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}

/**
 * Waits for a counted condition and says what it saw when it gives up.
 *
 * Counting rather than existence-checking, for the reason the e2e suite gives: "the list is
 * there" is also true of the empty list a failed request renders, and an empty list is exactly
 * what must never end up in a README.
 */
const waitForCount = async (page, selector, atLeast, label, budgetMs = 30_000) => {
  const deadline = Date.now() + budgetMs
  let seen = 0
  while (Date.now() < deadline) {
    seen = await page.locator(selector).count()
    if (seen >= atLeast) return seen
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`${label}: only ${seen} of the expected ${atLeast} \`${selector}\` after ${budgetMs} ms`)
}

const useEnglish = async (page) => {
  await page.click('[data-action="language-menu"]')
  await page.click('button[data-locale="en_US"]')
  // The menu closes on its own; the click below would otherwise land on the overlay.
  await page.waitForTimeout(300)
}

const signIn = async (page) => {
  await page.click('[data-action="direct-ip"]')
  await page.fill('input[name="host"]', FAKE_HOST)
  await page.fill('input[name="username"]', credentials.username)
  await page.fill('input[name="password"]', credentials.password)
  await page.locator('input[name="password"]').press('Enter')
  await page.waitForSelector('[data-action="sign-out"]', { timeout: 30_000 })
}

/**
 * Refuses to write a picture that carries something the recording cannot account for.
 *
 * Runs before EVERY capture, not once at the start: the Tailscale panel appears on the device
 * screen only, and a check that ran on the files screen would have been green for a leak two
 * clicks away.
 */
const assertNothingPrivate = async (page, name) => {
  const found = findPrivate(await page.locator('body').innerText())
  if (!isClean(found)) {
    throw new Error(
      `${name}: refusing to write — ${found.count} address(es) not from the recording ` +
        `(${found.masked.join(', ') || 'none'}), ${found.labels.length} tailnet label(s), ` +
        `${found.homes.length} home path(s) on screen. Something here is answering from the ` +
        `real machine, not from the fixture.`,
    )
  }
}

/**
 * Dismisses the keyring banner if the run has no secret store.
 *
 * Not cosmetic: the banner is a truthful statement about the RUNNING environment (a headless
 * container has no keyring), and a reader would take it for a statement about the program.
 * "Ask every time" is the choice a user makes, so this clicks it rather than hiding the panel.
 */
const dismissKeyringBanner = async (page) => {
  const button = page.getByRole('button', { name: 'Ask every time' })
  if ((await button.count()) > 0) {
    await button.first().click()
    await page.waitForTimeout(300)
  }
}

const shoot = async (page, name) => {
  await assertNothingPrivate(page, name)
  const path = join(OUT, `${name}.png`)
  await page.screenshot({ path })
  console.log(`  wrote ${path}`)
}

/**
 * Says whether the PATH filter had anything to do.
 *
 * A filter that removes nothing looks exactly like a filter that works. On a machine without
 * Tailscale the guard above is what carries the claim; on this machine it was the filter. Both
 * are fine — being unable to tell them apart is not.
 */
const reportPathFilter = () => {
  const before = (process.env['PATH'] ?? '').split(delimiter)
  const after = pathWithoutTailscale().split(delimiter)
  const removed = before.filter((dir) => dir !== '' && !after.includes(dir))
  console.log(
    removed.length > 0
      ? `PATH: removed ${removed.length} director(y|ies) holding a tailscale binary`
      : 'PATH: no tailscale binary found on it — nothing to remove',
  )
}

const main = async () => {
  mkdirSync(OUT, { recursive: true })
  reportPathFilter()
  const fake = await startFakeDevice()
  console.log('recorded device answering on port 80')

  try {
    // ---- wide, light: the four sections plus the way in -------------------------------
    const wide = await launch()
    try {
      await useEnglish(wide.page)
      await dismissKeyringBanner(wide.page)
      await shoot(wide.page, '01-connect')

      await signIn(wide.page)
      await shoot(wide.page, '02-device')

      await wide.page.click('nav button[data-nav="files"]')
      await waitForCount(wide.page, 'li', 10, 'files')
      await shoot(wide.page, '03-files')

      await wide.page.click('nav button[data-nav="photos"]')
      await waitForCount(wide.page, 'img', 10, 'photos')
      await shoot(wide.page, '04-photos')

      await wide.page.click('nav button[data-nav="apps"]')
      await waitForCount(wide.page, 'section', 5, 'apps')
      await shoot(wide.page, '05-apps')

      // ---- the same build in dark ----------------------------------------------------
      // `useTheme` follows `prefers-color-scheme` while the theme is on "system", so this
      // reaches the real code path rather than a hand-set attribute.
      await wide.page.emulateMedia({ colorScheme: 'dark' })
      await wide.page.click('nav button[data-nav="device"]')
      await wide.page.waitForTimeout(600)
      await shoot(wide.page, '06-dark')
    } finally {
      await close(wide)
    }

    // ---- narrow: the other layout, from a narrow window --------------------------------
    const narrow = await launch({ ZIMA_VERIFY_WIDTH: '460' })
    try {
      await useEnglish(narrow.page)
      await dismissKeyringBanner(narrow.page)
      await signIn(narrow.page)
      await narrow.page.click('nav button[data-nav="files"]')
      await waitForCount(narrow.page, 'li', 10, 'files (narrow)')
      await shoot(narrow.page, '07-narrow')
    } finally {
      await close(narrow)
    }
  } finally {
    await fake.stop()
    console.log('recorded device stopped')
  }
}

// Only when run as a program. The guard above is imported by its test, and a module that
// starts a device and six windows on import is not importable.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
