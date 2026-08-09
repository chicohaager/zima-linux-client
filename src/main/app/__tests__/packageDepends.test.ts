import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * `build.<target>.depends` REPLACES electron-builder's default dependency list — it does not
 * extend it. Same shape as the `afterInstall` trap next door (see afterInstallScript.test.ts),
 * one field further along, and it cost a start:
 *
 * Measured 2026-08-09 in the distro matrix, ubuntu:24.04, on the freshly built 2.0.0-alpha.1
 * .deb. `build.deb.depends` said `["libcap2-bin"]`, so the package declared that one library and
 * none of the nine electron-builder declares by default. `apt-get install ./pkg.deb` succeeded,
 * and the app then died before any window:
 *
 *     /usr/bin/zima-linux-client: error while loading shared libraries: libnspr4.so:
 *     cannot open shared object file: No such file or directory        → exit 127
 *
 * (libnspr4 comes with libnss3, which was the missing declaration.) On a desktop that already
 * has GTK and NSS installed the loss is invisible — which is exactly why it survived: every
 * machine we had built and started on was such a desktop.
 *
 * So this test does not compare against a hand-copied list. It reads the CURRENT defaults out of
 * app-builder-lib and demands ours be a superset. An electron-builder upgrade that adds a
 * dependency turns this red instead of shipping a package that declares less than the default.
 *
 * The additions on top of the defaults are measured too, per distro (2026-08-09):
 *   deb     libcap2-bin        `setcap` is absent on ubuntu:24.04; the post-install needs it
 *   rpm     /usr/sbin/setcap   a file dependency, because the package differs by distro —
 *                              fedora:41 resolves it to `libcap`, tumbleweed to `libcap-progs`
 *                              (and there `setcap` really is missing from the base image)
 *   pacman  libcap             owns /usr/bin/setcap on Arch
 */
const FPM_TARGET = 'app-builder-lib/out/targets/FpmTarget.js'

/** What we add on top of the stock list, and why it may not be dropped. */
const OUR_ADDITIONS: Readonly<Record<string, string>> = {
  deb: 'libcap2-bin',
  rpm: '/usr/sbin/setcap',
  pacman: 'libcap',
}

/**
 * Stock defaults we deliberately do NOT carry — one entry per name, each with the measurement
 * that justifies it. Never a blanket opt-out: an allowance as wide as the rule deletes the rule.
 *
 * A dropped name is also required to still BE a stock default (asserted below). Once
 * electron-builder removes it, the exception has outlived its reason and must go with it,
 * instead of sitting here excusing something nobody declares any more.
 */
const DROPPED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  deb: {},
  rpm: {},
  pacman: {
    'http-parser':
      'measured 2026-08-09 on archlinux:latest — the package no longer exists in any Arch'
      + ' repository (`pacman -Si http-parser` and `pacman -Sp http-parser` both fail). While it'
      + ' was declared, installing the .pacman package aborted with "cannot resolve http-parser,'
      + ' a dependency of zima-linux-client" — the package was uninstallable on current Arch.',
  },
}

const declared = (target: string): string[] => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  return manifest.build?.[target]?.depends ?? []
}

type DependsHolder = { prototype: { getDefaultDepends(target: string): string[] } }

const hasDefaultDepends = (candidate: unknown): candidate is DependsHolder =>
  typeof candidate === 'function' &&
  typeof (candidate as DependsHolder).prototype?.getDefaultDepends === 'function'

/**
 * Unwraps `default` until the class turns up, instead of assuming a nesting depth.
 *
 * This module is CJS, and how many `default` wrappers an import puts around it is a property of
 * the loader, not of the package: plain Node hands back `module.default.default`, Vite one level
 * less. The first version of this test hard-coded Node's shape and every case failed under
 * vitest with "Cannot read properties of undefined" — a red test for the loader, saying nothing
 * about the dependency lists it was written to guard.
 */
const stockDefaults = async (target: string): Promise<string[]> => {
  let candidate: unknown = await import(FPM_TARGET)
  for (let depth = 0; depth < 5 && !hasDefaultDepends(candidate); depth += 1) {
    candidate = (candidate as { default?: unknown })?.default
  }
  if (!hasDefaultDepends(candidate)) {
    throw new Error(`no getDefaultDepends found in ${FPM_TARGET} — did electron-builder rename it?`)
  }
  // `getDefaultDepends` is a pure switch and touches no `this`, so the prototype is enough —
  // constructing an FpmTarget would need a whole packager context.
  return candidate.prototype.getDefaultDepends.call(null, target)
}

describe('build.deb.depends, the ALSA entry in particular', () => {
  /**
   * It must stay an ALTERNATIVE, and `libasound2t64` must come first.
   *
   * Measured 2026-08-09 in the distro matrix. With a plain `libasound2`, the package installs on
   * ubuntu:24.04 and then dies before any window:
   *
   *     symbol lookup error: undefined symbol: snd_device_name_get_hint, version ALSA_0.9
   *
   * On 24.04 `libasound2` is only a VIRTUAL name (the real library is `libasound2t64` after the
   * time_t transition), and a second package provides that name too: `liboss4-salsa-asound2`, an
   * OSS compatibility shim. apt picked the shim — `dpkg -l` after the install showed
   * `liboss4-salsa-asound2` and no `libasound2t64`. The shim carries the soname and not the
   * symbols, so this fails at startup rather than at install time, which is the worse half.
   *
   * `libasound2t64 | libasound2` names the real package first and keeps ubuntu:22.04 and
   * debian:12 working, where `libasound2` is a real package and `…t64` does not exist.
   */
  it('prefers the real library over anything else that merely provides the name', () => {
    const alsa = declared('deb').filter((d) => d.includes('libasound'))
    expect(alsa, 'exactly one ALSA entry expected').toHaveLength(1)
    expect(alsa[0]).toBe('libasound2t64 | libasound2')
  })
})

describe('build.<target>.depends', () => {
  for (const target of ['deb', 'rpm', 'pacman']) {
    it(`${target}: carries every dependency electron-builder declares by default`, async () => {
      const stock = await stockDefaults(target)

      // Guards the guard. If a future electron-builder renames the method or returns nothing,
      // a superset check against an empty list would pass while asserting nothing at all.
      expect(stock.length, `no stock defaults readable for ${target} — check ${FPM_TARGET}`).
        toBeGreaterThan(5)

      const ours = declared(target)
      expect(ours.length, `build.${target}.depends is unset — it would silently take the`
        + ' defaults today and lose them the moment someone sets it').toBeGreaterThan(0)

      const dropped = DROPPED[target] ?? {}
      const missing = stock.filter(
        (dependency) => !ours.includes(dependency) && dropped[dependency] === undefined,
      )
      expect(missing, `defaults absent from build.${target}.depends`).toEqual([])
    })

    it(`${target}: every deliberate omission still names something the stock list declares`, async () => {
      // Keeps the exception list from outliving its reason. An entry for a name electron-builder
      // no longer ships excuses nothing and would quietly widen the allowance over time.
      const stock = await stockDefaults(target)
      const stale = Object.keys(DROPPED[target] ?? {}).filter((name) => !stock.includes(name))
      expect(stale, `no longer a stock default — remove the exception too`).toEqual([])
    })

    it(`${target}: still declares what the post-install script needs`, () => {
      // Without this the ZeroTier route fails at install time — loudly in the install log,
      // but silently for anyone who does not read it.
      expect(declared(target)).toContain(OUR_ADDITIONS[target])
    })
  }
})
