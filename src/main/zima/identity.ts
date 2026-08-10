import { z } from 'zod'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { request } from './client'
import { BASE, SYSTEM } from './endpoints'

/**
 * "Is the box at this address the device I already know?"
 *
 * Answered with `device_code` from `GET /v2/zimaos/device/info`, which needs **no
 * credentials** — so the question can be asked of an unknown host in the LAN without ever
 * sending it a token. Measured 2026-08-10 on a real network — addresses and codes below are
 * documentation values (RFC 5737), the outcomes are the measured ones:
 *
 *   192.0.2.10    0f3b7c9e-…   ZimaOS     v1.7.0
 *   198.51.100.10   0f3b7c9e-…   ← same device, other path  ⇒ identifies the DEVICE
 *   198.51.100.20    9a8b7c6d-…   ZimaBoard  v1.6.2          ⇒ differs between devices
 *   after a real reboot of that host (uptime -s moved):  0f3b7c9e-…  unchanged
 *
 * 🔴 The reason this module parses instead of trusting a status code: a **foreign** service
 * answers the very same request with HTTP 200. Measured on the same host — Dozzle on port
 * 8888 returns `200` and 1439 bytes of HTML for `/v2/zimaos/device/info`. "Status 200 means
 * ZimaOS" is the obvious check and it is wrong; every hit must survive JSON parsing, the
 * schema below, and an exact comparison of the code itself.
 *
 * Failing closed is the whole point. An unrecognised answer means "not the same device",
 * which costs a convenience. A wrongly recognised one would attach a stranger's address to
 * a device entry and point a session at the wrong machine.
 */

/**
 * `device_code` is the only field required here.
 *
 * `device_name` and `os_version` are read for the log line, but must not be part of the
 * decision: names collide (two hosts both answer "ZimaOS") and versions differ between two
 * paths to the same box over time. Anything not needed for the judgement stays optional so
 * a firmware that drops a cosmetic field cannot break recognition.
 */
const deviceInfoSchema = z.looseObject({
  device_code: z.string().min(8),
  device_name: z.string().optional(),
  os_version: z.string().optional(),
})

export interface DeviceIdentity {
  readonly deviceCode: string
  readonly deviceName: string | null
  readonly osVersion: string | null
}

/**
 * Asks a host who it is. Never throws, never sends credentials.
 *
 * The timeout is short on purpose: this runs against addresses found by discovery, and a
 * host that does not answer in two and a half seconds is not the path we are looking for
 * anyway — the point of the whole exercise is to find one that answers in milliseconds.
 */
export const fetchIdentity = async (
  host: string,
  port = 80,
  timeoutMs = 2_500,
): Promise<Result<DeviceIdentity>> => {
  const answer = await request<unknown>(host, port, `${BASE.zimaos}${SYSTEM.deviceInfo}`, {
    timeoutMs,
  })
  if (isErr(answer)) return answer

  const parsed = deviceInfoSchema.safeParse(answer.value)
  if (!parsed.success) {
    // Not an error worth alarming anyone about: most hosts in a LAN are not ZimaOS.
    return err(
      appError('malformed-response', 'not a ZimaOS device info document', 'error.notAZimaDevice', {
        host,
      }),
    )
  }

  return ok({
    deviceCode: parsed.data.device_code,
    deviceName: parsed.data.device_name ?? null,
    osVersion: parsed.data.os_version ?? null,
  })
}

/**
 * Whether two identities describe the same device.
 *
 * A function rather than `a === b` at the call sites, so the rule has one home: exact
 * match, no trimming, no case folding, and an empty or missing code never matches — a
 * device whose code we do not know must not become "equal to everything".
 */
export const sameDevice = (stored: string | null | undefined, measured: string): boolean =>
  typeof stored === 'string' && stored.length > 0 && stored === measured
