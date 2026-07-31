import { describe, expect, it } from 'vitest'
import { resolveRelaunchTarget } from '@main/app/resilientPlatform'

/**
 * These cases are the three worlds this app is actually started from, and they were
 * written after the AppImage one was measured to fail in the packaged artifact — not
 * imagined. Each fixture carries the values that were read off the real build, so a
 * simplification here would be visible.
 */
describe('resolveRelaunchTarget', () => {
  const alwaysExists = (): boolean => true
  const neverExists = (): boolean => false

  it('uses the executable itself when it is installed', () => {
    // .deb/.rpm/.pacman/tar.gz: /opt/<product>/… stays put across the relaunch.
    const target = resolveRelaunchTarget({}, '/opt/ZimaOS Client/zima-linux-client', alwaysExists)
    expect(target).toEqual({ kind: 'self', execPath: '/opt/ZimaOS Client/zima-linux-client' })
  })

  it('uses the .AppImage file, not the mount the process would take with it', () => {
    // Values measured from inside the packaged AppImage on 2026-07-31.
    const target = resolveRelaunchTarget(
      {
        APPIMAGE: '/home/user/Downloads/ZimaOS Client-2.0.0-alpha.1.AppImage',
        APPDIR: '/tmp/.mount_ZimaOSkCxb9M',
      },
      '/tmp/.mount_ZimaOSkCxb9M/zima-linux-client',
      alwaysExists,
    )
    expect(target).toEqual({
      kind: 'appimage',
      execPath: '/home/user/Downloads/ZimaOS Client-2.0.0-alpha.1.AppImage',
    })
  })

  /**
   * Positive control for the bug this function was written for: with the old code the
   * relaunch ran from the mount path and died silently. The assertion is deliberately
   * about what must NOT be chosen — a test that only checked "some path comes back"
   * would have passed on the broken version too.
   */
  it('never hands back a path inside the AppImage mount', () => {
    const mounted = '/tmp/.mount_ZimaOSkCxb9M/zima-linux-client'
    const target = resolveRelaunchTarget(
      { APPIMAGE: '/home/user/Downloads/ZimaOS.AppImage', APPDIR: '/tmp/.mount_ZimaOSkCxb9M' },
      mounted,
      alwaysExists,
    )
    expect(target.kind === 'no-stable-path' ? '' : target.execPath).not.toBe(mounted)
  })

  it('refuses to relaunch from an AppDir that has no AppImage behind it', () => {
    // `--appimage-extract-and-run` and hand-unpacked AppDirs land here.
    const target = resolveRelaunchTarget(
      { APPDIR: '/tmp/appimage-extracted' },
      '/tmp/appimage-extracted/zima-linux-client',
      alwaysExists,
    )
    expect(target.kind).toBe('no-stable-path')
    expect(target.kind === 'no-stable-path' && target.why).toContain('APPIMAGE is not set')
  })

  it('refuses when APPIMAGE points at a file that is gone', () => {
    // The user deleted or moved the .AppImage after starting it.
    const target = resolveRelaunchTarget(
      { APPIMAGE: '/home/user/Downloads/ZimaOS.AppImage', APPDIR: '/tmp/.mount_x' },
      '/tmp/.mount_x/zima-linux-client',
      neverExists,
    )
    expect(target.kind).toBe('no-stable-path')
    expect(target.kind === 'no-stable-path' && target.why).toContain('does not exist')
  })

  it('ignores a relative APPIMAGE value', () => {
    // The runtime sets an absolute path; anything else is not something to exec.
    const target = resolveRelaunchTarget(
      { APPIMAGE: './ZimaOS.AppImage', APPDIR: '/tmp/.mount_x' },
      '/tmp/.mount_x/zima-linux-client',
      alwaysExists,
    )
    expect(target.kind).toBe('no-stable-path')
  })
})
