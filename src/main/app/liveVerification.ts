import { writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { isErr } from '@shared/result'
import { logger } from '@main/logging/logger'
import * as registry from '@main/devices/registry'
import * as session from '@main/session'
import { baseUrl } from '@main/zima/client'
import { cleanupProbes, PROBE_ROOT, READ_PROBES, writeProbes, type Probe } from './liveProbes'
import { renderShape, shapeOf } from './responseShape'

/**
 * `npm run verify:live` — Plan § 11.3.
 *
 * Runs every endpoint this client uses against a real device and reports
 * `METHOD PATH -> STATUS BYTES` plus the shape of the answer. It is the tool that keeps
 * the verification comments in `endpoints.ts` honest: a comment claiming a status is only
 * worth something if a run produced it.
 *
 * Three deliberate design points:
 *
 *  - **It measures at the wire, with `fetch` directly**, not through our own
 *    `zima/client.ts`. A measurement that goes through the code under test would report
 *    that code's interpretation — envelope unwrapped, status swallowed — instead of what
 *    the device said.
 *  - **It uses the real session path** (`session.resume`) to obtain a token, so the
 *    refresh-token rotation and its write-back are exactly the ones the app performs. A
 *    hand-rolled login here would measure a code path no user takes.
 *  - **It never reports a green run it did not make.** An unreachable device, a missing
 *    stored credential or a probe that could not be sent are failures with names.
 */

export interface ProbeMeasurement {
  readonly id: string
  readonly method: string
  readonly path: string
  readonly status: number | null
  readonly bytes: number | null
  readonly contentType: string | null
  readonly ms: number | null
  readonly shape: unknown
  readonly asks: string
  /** Verbatim body of a >= 400 answer. The wording is the contract information. */
  readonly errorBody?: string
  /** Set when the probe could not be sent at all — with the transport reason. */
  readonly transportError?: string
  /** Set when the probe was skipped, with the reason. Never silently omitted. */
  readonly skipped?: string
}

export interface LiveReport {
  readonly ok: boolean
  readonly deviceId: string
  readonly host: string
  readonly appVersion: string
  readonly startedAtIso: string
  readonly photosModule: boolean
  readonly writeProbesRun: boolean
  readonly measurements: readonly ProbeMeasurement[]
  readonly failures: readonly string[]
  /** Probes whose status differed from the documented expectation — stale comments. */
  readonly surprises: readonly string[]
}

export const isEnabled = (): boolean => (process.env['ZIMA_VERIFY_LIVE'] ?? '').length > 0

const send = async (
  origin: string,
  probe: Probe,
  token: string,
): Promise<ProbeMeasurement> => {
  const url = new URL(`${origin}${probe.path}`)
  for (const [key, value] of Object.entries(probe.query ?? {})) {
    url.searchParams.set(key, String(value))
  }
  const startedAt = Date.now()
  try {
    const response = await fetch(url.toString(), {
      method: probe.method,
      headers: {
        accept: 'application/json',
        // Bare token, no `Bearer` — measured 2026-07-30, see zima/client.ts.
        authorization: token,
        ...(probe.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    let parsed: unknown = text.length === 0 ? null : text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON is a finding, not an error: `/thumbnail` and `/file/download` answer with
      // bytes. The content type in the report says which it was.
    }
    return {
      id: probe.id,
      method: probe.method,
      path: `${probe.path}${url.search}`,
      status: response.status,
      bytes: text.length,
      contentType: response.headers.get('content-type'),
      ms: Date.now() - startedAt,
      shape: typeof parsed === 'string' ? `non-json(len=${parsed.length})` : shapeOf(parsed),
      asks: probe.asks,
      // For a rejection the message text IS the measurement: "invalid path" and
      // "missing field src" call for completely different client code, and a shape of
      // `{message:string(len=71)}` says neither. Only kept for >= 400 answers, and only
      // in the local report — a success payload stays values-free.
      ...(response.status >= 400 ? { errorBody: text.slice(0, 400) } : {}),
    }
  } catch (cause) {
    return {
      id: probe.id,
      method: probe.method,
      path: probe.path,
      status: null,
      bytes: null,
      contentType: null,
      ms: Date.now() - startedAt,
      shape: null,
      asks: probe.asks,
      transportError: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    }
  }
}

const chooseDevice = (): { id: string; host: string; port: number } | string => {
  const wanted = process.env['ZIMA_VERIFY_DEVICE']
  const devices = registry.list()
  if (devices.length === 0) return 'the device registry is empty — sign in once first'

  const device =
    wanted !== undefined && wanted.length > 0
      ? devices.find((d) => d.id === wanted)
      : (devices.find((d) => d.id === registry.activeDeviceId()) ?? devices[0])
  if (device === undefined) return `no device with id "${wanted ?? ''}" in the registry`

  const address = registry.byPriority(device.addresses)[0]
  if (address === undefined) return `device ${device.id} has no address`
  return { id: device.id, host: address.host, port: address.port }
}

/**
 * Runs the probe table and writes the report.
 *
 * Called before any window exists: this tool needs a session and a network, not a UI.
 */
export const runLiveVerification = async (): Promise<void> => {
  const reportPath = process.env['ZIMA_VERIFY_LIVE']
  if (reportPath === undefined) return
  const failures: string[] = []
  const surprises: string[] = []
  const measurements: ProbeMeasurement[] = []

  const chosen = chooseDevice()
  if (typeof chosen === 'string') {
    await writeFile(
      reportPath,
      `${JSON.stringify({ ok: false, failures: [chosen] }, null, 2)}\n`,
    )
    logger.error('live.no-device', { reason: chosen })
    app.exit(1)
    return
  }

  const resumed = await session.resume(chosen.id)
  if (isErr(resumed)) {
    // Named, not swallowed: without a session every probe below would answer 401 and the
    // report would look like "the device rejects everything".
    const reason = `session.resume failed: ${resumed.error.kind} — ${resumed.error.message}`
    await writeFile(reportPath, `${JSON.stringify({ ok: false, failures: [reason] }, null, 2)}\n`)
    logger.error('live.no-session', { kind: resumed.error.kind })
    app.exit(1)
    return
  }

  const token = await session.accessToken()
  if (isErr(token)) {
    const reason = `no access token after resume: ${token.error.kind}`
    await writeFile(reportPath, `${JSON.stringify({ ok: false, failures: [reason] }, null, 2)}\n`)
    app.exit(1)
    return
  }

  const origin = baseUrl(chosen.host, chosen.port)
  const photosModule = resumed.value.capabilities?.photoLibrary === true
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')

  const wantWrite = (process.env['ZIMA_VERIFY_WRITE'] ?? '') === '1'
  const scratch = `${PROBE_ROOT}/zima-client-verify-${stamp}`
  const stale = (process.env['ZIMA_VERIFY_CLEANUP'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  const table: readonly Probe[] = [
    ...READ_PROBES,
    ...(wantWrite ? writeProbes(scratch, 'measurement.txt') : []),
    ...cleanupProbes(stale),
  ]

  process.stdout.write(`\nverify:live  device=${chosen.id}  host=${chosen.host}\n`)
  process.stdout.write(`             photos module: ${photosModule ? 'present' : 'absent'}\n\n`)

  for (const probe of table) {
    if (probe.requires === 'photos' && !photosModule) {
      // A skip is recorded with its reason. Dropping it would make the report look like
      // full coverage of a surface that was never asked.
      measurements.push({
        id: probe.id,
        method: probe.method,
        path: probe.path,
        status: null,
        bytes: null,
        contentType: null,
        ms: null,
        shape: null,
        asks: probe.asks,
        skipped: 'photos module not registered on this device',
      })
      process.stdout.write(`  SKIP  ${probe.method.padEnd(6)} ${probe.path}  (no photos module)\n`)
      continue
    }

    const measured = await send(origin, probe, token.value)
    measurements.push(measured)
    if (measured.transportError !== undefined) {
      failures.push(`${probe.id}: could not be sent — ${measured.transportError}`)
      process.stdout.write(`  FAIL  ${probe.method.padEnd(6)} ${probe.path}  ${measured.transportError}\n`)
      continue
    }
    // A status that differs from the documented expectation is called out loudly but is
    // NOT a tool failure: it means the endpoint comment in `endpoints.ts` has gone stale,
    // which is precisely what this run is supposed to surface.
    const surprise =
      probe.expect !== undefined && measured.status !== probe.expect
        ? `  <- expected ${probe.expect}`
        : ''
    if (surprise !== '') surprises.push(`${probe.id}: expected ${probe.expect}, got ${measured.status}`)
    process.stdout.write(
      `  ${String(measured.status).padStart(4)}  ${probe.method.padEnd(6)} ${probe.path.padEnd(38)} ` +
        `${String(measured.bytes).padStart(7)}B  ${renderShape(measured.shape, 120)}${surprise}\n`,
    )
  }

  const report: LiveReport = {
    // The run is green when every probe was *answered*. A 400 or 500 is a measurement,
    // not a failure of the tool — that distinction is the whole point of this report.
    ok: failures.length === 0,
    deviceId: chosen.id,
    host: chosen.host,
    appVersion: app.getVersion(),
    startedAtIso: new Date().toISOString(),
    photosModule,
    writeProbesRun: wantWrite,
    measurements,
    failures,
    surprises,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(
    `\n  ${measurements.length} probes, ${failures.length} unsendable, ` +
      `${surprises.length} unexpected status.\n  Report: ${reportPath}\n\n`,
  )
  for (const surprise of surprises) process.stdout.write(`  ! ${surprise}\n`)
  logger.info('live.verified', { ok: report.ok, probes: measurements.length })
  app.exit(report.ok ? 0 : 1)
}
