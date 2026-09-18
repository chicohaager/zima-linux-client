import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `build/linux-after-install.sh` REPLACES electron-builder's stock after-install template
 * (app-builder-lib 26.15.3, `targets/FpmTarget.js:68` — `getResource(options.afterInstall,
 * "after-install.tpl")` returns the custom file instead of the template). Nothing in the
 * build says so; the package is produced happily either way.
 *
 * The first version of this script only granted the ZeroTier capability, and silently dropped
 * the rest. Measured 2026-07-31 on the installed 2.0.0-alpha.1 package: no
 * /usr/bin/zima-linux-client, no /etc/apparmor.d/zima-linux-client, chrome-sandbox left at 0755.
 * With the namespace sandbox unavailable, Chromium then aborts instead of starting:
 *
 *     FATAL setuid_sandbox_host.cc:166 "The SUID sandbox helper binary was found, but is not
 *     configured correctly. Rather than run without sandboxing I'm aborting now."
 *
 * So this test does not check a hand-copied list of expectations — it reads the CURRENT stock
 * template out of node_modules and demands that every instruction in it also exists in our
 * script. When electron-builder changes its template, this goes red instead of us shipping a
 * package that quietly does less than the default one.
 */
const OUR_SCRIPT = 'build/linux-after-install.sh'
const STOCK_TEMPLATE = 'node_modules/app-builder-lib/templates/linux/after-install.tpl'

const instructions = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('#!'))

describe('build/linux-after-install.sh', () => {
  it('carries every instruction of the stock after-install template', () => {
    // A missing template is a finding of its own: it would make this test vacuously green.
    expect(existsSync(STOCK_TEMPLATE), `${STOCK_TEMPLATE} not found`).toBe(true)

    const ours = readFileSync(OUR_SCRIPT, 'utf8')
    const stock = instructions(readFileSync(STOCK_TEMPLATE, 'utf8'))

    // Guards the guard: an empty or comment-only template would assert nothing at all.
    expect(stock.length).toBeGreaterThan(15)

    const missing = stock.filter((line) => !ours.includes(line))
    expect(missing, `stock template lines absent from ${OUR_SCRIPT}`).toEqual([])
  })

  it('raises chrome-sandbox to 4755 where user namespaces are unavailable', () => {
    // The single line whose absence costs a start on every machine without working userns.
    const ours = readFileSync(OUR_SCRIPT, 'utf8')
    expect(ours).toMatch(/chmod 4755 .*chrome-sandbox/)
    expect(ours).toMatch(/unshare --user true/)
  })

  it('still grants the ZeroTier capability, after the stock part', () => {
    const ours = readFileSync(OUR_SCRIPT, 'utf8')
    const setcapAt = ours.indexOf('setcap cap_net_admin,cap_net_raw,cap_net_bind_service+eip')
    const sandboxAt = ours.indexOf('chmod 4755')

    expect(setcapAt).toBeGreaterThan(-1)
    expect(sandboxAt).toBeGreaterThan(-1)
    // Order matters only in one direction: the stock work must not sit behind an `exit 0`
    // that our own early returns can reach.
    expect(setcapAt).toBeGreaterThan(sandboxAt)
  })

  it('does not abort the installation on a failing step', () => {
    // The stock template deliberately runs without `set -e`; an apparmor_parser hiccup must
    // not fail the package install. Our block reports failures instead of swallowing them.
    const ours = readFileSync(OUR_SCRIPT, 'utf8')
    expect(ours).not.toMatch(/^\s*set -e/m)
    expect(ours.trimEnd().endsWith('exit 0')).toBe(true)
  })
})

/**
 * pacman runs `post_install` on the FIRST install only; a reinstall or upgrade calls
 * `post_upgrade`, which fpm writes only when handed `--after-upgrade`. Measured 2026-09-18 on
 * CachyOS with the 2.0.1 release package: the second `pacman -U` left zerotier-one without
 * CAP_NET_ADMIN and chrome-sandbox at 0755 — the Remote-ID route gone, and every start gone on
 * a machine without user namespaces. dpkg and rpm run their post-install on upgrade as well.
 */
describe('pacman upgrade hook', () => {
  const HOOK = 'build/pacman-after-upgrade.sh'
  const config = JSON.parse(readFileSync('package.json', 'utf8')) as {
    build: { pacman: { fpm?: string[] } }
  }

  it('is passed to fpm for the pacman target', () => {
    expect(config.build.pacman.fpm ?? []).toContain(`--after-upgrade=${HOOK}`)
  })

  it('re-runs the macro-substituted post_install instead of duplicating it', () => {
    expect(existsSync(HOOK), `${HOOK} not found`).toBe(true)
    // One instruction, no second copy of any path: the paths live in linux-after-install.sh
    // and are substituted by electron-builder there — this file is pasted in raw.
    expect(instructions(readFileSync(HOOK, 'utf8'))).toEqual(['post_install "$@"'])
  })
})

/**
 * `build/linux-after-remove.sh` replaces the stock after-remove template by the same
 * mechanism. It exists for one guard: rpm runs the OLD package's %postun after the NEW
 * package's %post on every upgrade and passes `$1=1`; the stock template ignores that and its
 * `update-alternatives --remove` deleted the launcher on Fedora 41/44 and openSUSE — measured
 * 2026-09-18 by the distro matrix's reinstall step.
 */
describe('build/linux-after-remove.sh', () => {
  const OUR_REMOVE = 'build/linux-after-remove.sh'
  const STOCK_REMOVE = 'node_modules/app-builder-lib/templates/linux/after-remove.tpl'
  const config = JSON.parse(readFileSync('package.json', 'utf8')) as {
    build: Record<string, { afterRemove?: string }>
  }

  it('is wired into deb, rpm and pacman', () => {
    for (const target of ['deb', 'rpm', 'pacman']) {
      expect(config.build[target]?.afterRemove, target).toBe(OUR_REMOVE)
    }
  })

  it('carries every instruction of the stock after-remove template', () => {
    expect(existsSync(STOCK_REMOVE), `${STOCK_REMOVE} not found`).toBe(true)
    const ours = readFileSync(OUR_REMOVE, 'utf8')
    const stock = instructions(readFileSync(STOCK_REMOVE, 'utf8'))
    expect(stock.length).toBeGreaterThan(8)
    const missing = stock.filter((line) => !ours.includes(line))
    expect(missing, `stock template lines absent from ${OUR_REMOVE}`).toEqual([])
  })

  it('skips the removal on an upgrade, before the stock part', () => {
    const ours = readFileSync(OUR_REMOVE, 'utf8')
    // Measured on the instruction lines, not the raw text: the header comment mentions
    // `update-alternatives --remove` too, and the first draft of this test found that one.
    const lines = instructions(ours)
    const guardAt = lines.findIndex((line) => line.startsWith('upgrade) exit 0'))
    const removeAt = lines.findIndex((line) => line.startsWith('update-alternatives --remove'))
    expect(guardAt).toBeGreaterThan(-1)
    expect(removeAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(removeAt)
    // rpm's signal is an integer count, dpkg's is the word; a version string must NOT match.
    expect(ours).toMatch(/\[ "\$ARG" -ge 1 \]/)
    expect(ours).toMatch(/\*\[!0-9\]\*\)/)
  })
})
