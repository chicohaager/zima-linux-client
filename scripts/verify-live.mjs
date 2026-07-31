#!/usr/bin/env node
/**
 * Launcher for the live endpoint measurement — Plan § 11.3.
 *
 * The measurement itself lives in the main process (`src/main/app/liveVerification.ts`)
 * because the stored refresh token is sealed with Electron's `safeStorage`: only the app
 * itself can open it. A plain Node script could not obtain a session without asking for a
 * password, and a password prompt in a verification tool invites hardcoding one.
 *
 * Usage:
 *   npm run verify:live                 # read-only probes against the active device
 *   npm run verify:live -- --device name:ZimaOS-2
 *   npm run verify:live -- --write      # adds the confined write probes (see liveProbes.ts)
 *
 * Exit codes: 0 every probe was answered, 1 something could not be measured. A 400 or 500
 * from the device is data, not a failure of this tool.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

if (!existsSync('out/main/index.js')) {
  console.error('out/main/index.js is missing — run `npm run build` first.')
  process.exit(1)
}

const reportDir = value('out') ?? 'reports'
mkdirSync(reportDir, { recursive: true })
const reportPath = join(reportDir, `verify-live-${new Date().toISOString().slice(0, 10)}.json`)

const env = { ...process.env, ZIMA_VERIFY_LIVE: reportPath }
const device = value('device')
if (device !== undefined) env.ZIMA_VERIFY_DEVICE = device
if (flag('write')) env.ZIMA_VERIFY_WRITE = '1'
const cleanup = value('cleanup')
if (cleanup !== undefined) env.ZIMA_VERIFY_CLEANUP = cleanup
// `--upload <localfile>:<device directory>` exercises the real upload path. The multipart
// field names are the only part of the upload protocol that cannot be read off the shipped
// SDK, so they are proved by an actual transfer rather than by a comment.
const upload = value('upload')
if (upload !== undefined) env.ZIMA_VERIFY_UPLOAD = upload
const cleanupFiles = value('cleanup-files')
if (cleanupFiles !== undefined) env.ZIMA_VERIFY_CLEANUP_FILES = cleanupFiles

// The app takes a single-instance lock. If it is already running, the second process quits
// before it can measure anything — and a missing report would otherwise read as "nothing
// to report" instead of "it never ran".
//
// 🔴 Checking only for the file's EXISTENCE was not enough. On 2026-07-30 a run was blocked
// by the lock, wrote nothing, and this script reported "verify:live ok — 28 probes" from a
// report four hours old. A stale artefact at the expected path is the classic proxy signal:
// it looks exactly like a fresh result. So the old one is removed first, and its absence
// afterwards means the run did not happen.
if (existsSync(reportPath)) rmSync(reportPath)

const electron = join('node_modules', 'electron', 'cli.js')
const run = spawnSync(process.execPath, [electron, '.'], { env, stdio: 'inherit' })

if (!existsSync(reportPath)) {
  console.error(
    '\nNo report was written. The most likely reason is that the app is already running ' +
      '(single-instance lock) — close it and run this again.',
  )
  process.exit(1)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
if (report.ok !== true) {
  console.error(`\nverify:live FAILED:\n${(report.failures ?? []).map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(`verify:live ok — ${report.measurements.length} probes measured against ${report.host}`)
process.exit(run.status ?? 0)
