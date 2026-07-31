import { z } from 'zod'
import type { DeviceInfo, StorageVolume, SystemStateAction, Utilization } from '@shared/domain'
import { appError, err, isErr, ok, type Result } from '@shared/result'
import { authed, type DeviceContext } from './client'
import { BASE, STORAGE, SYS, SYSTEM, systemState } from './endpoints'

/**
 * Device figures for the dashboard, and the two power actions.
 *
 * All paths measured 2026-07-30 with a valid token. Three of them were WRONG in the
 * earlier version of this client and answered 404 — hardware and load live under `/v1/sys`,
 * storage under `/v2/local_storage`, not under `/v2/zimaos`. The comments say which,
 * because "it is under /v2/zimaos" was exactly the plausible assumption that cost the time.
 */

const parse = <S extends z.ZodTypeAny>(
  schema: S,
  payload: unknown,
  where: string,
): Result<z.output<S>> => {
  const parsed = schema.safeParse(payload)
  return parsed.success
    ? ok(parsed.data)
    : err(
        appError('malformed-response', `${where}: ${parsed.error.issues[0]?.message ?? 'unparseable'}`,
          'error.malformedResponse', { where }),
      )
}

/**
 * live: GET /v1/sys/utilization ->
 * `{data:{cpu:{model,num,percent,temperature,power:{value,timestamp}},mem:{total,used,usedPercent},
 *   net:[…],sys_disk:{size,used,avail,health}}}`
 *
 * `power.value` is a STRING on the wire. Parsed with a number coercion rather than assumed
 * numeric — a `Number(undefined)` would have produced NaN and rendered "NaN W".
 */
const utilizationSchema = z.looseObject({
  cpu: z.looseObject({
    model: z.string().optional(),
    num: z.number().optional(),
    percent: z.number(),
    temperature: z.number().optional(),
    power: z
      .looseObject({
        value: z.union([z.string(), z.number()]).optional(),
        /** Unix seconds the counter was read at — needed to turn it into a rate. */
        timestamp: z.union([z.string(), z.number()]).optional(),
      })
      .optional(),
  }),
  mem: z.looseObject({ total: z.number(), used: z.number(), usedPercent: z.number() }),
  sys_disk: z
    .looseObject({
      size: z.number().optional(),
      used: z.number().optional(),
      health: z.boolean().optional(),
    })
    .optional(),
})

const finiteOrNull = (value: string | number | undefined): number | null => {
  if (value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * The previous energy sample, so a rate can be derived at all.
 *
 * Module-scoped because the client talks to one active device at a time; a device switch
 * makes the first reading afterwards return null, which is correct — a counter from another
 * machine must never be subtracted from this one's.
 */
let lastEnergySample: { microjoules: number; atSeconds: number; host: string } | null = null

/**
 * Watts from two readings of the energy counter, or null when there is only one.
 *
 * Null on the first call is deliberate and the UI shows a dash for it. Inventing a number
 * from a single counter reading is exactly how "10251150514 W" reached the screen.
 */
const derivePowerWatt = (microjoules: number | null, atSeconds: number | null): number | null => {
  if (microjoules === null || atSeconds === null) return null
  const previous = lastEnergySample
  lastEnergySample = { microjoules, atSeconds, host: activeSampleHost }
  if (previous === null || previous.host !== activeSampleHost) return null

  const seconds = atSeconds - previous.atSeconds
  const delta = microjoules - previous.microjoules
  // A counter reset (reboot, wrap) or two samples inside the same second cannot produce a
  // rate. Reported as "unknown" rather than as a negative or an infinite wattage.
  if (seconds <= 0 || delta < 0) return null
  return delta / seconds / 1_000_000
}

/** Host the current sample belongs to, set by readUtilization before it derives. */
let activeSampleHost = ''

export const readUtilization = async (ctx: DeviceContext): Promise<Result<Utilization>> => {
  activeSampleHost = ctx.host
  const answer = await authed<unknown>(ctx, `${BASE.sys}${SYS.utilization}`)
  if (isErr(answer)) return answer
  const parsed = parse(utilizationSchema, answer.value, 'utilization')
  if (isErr(parsed)) return parsed
  const { cpu, mem, sys_disk: disk } = parsed.value
  return ok({
    cpuPercent: cpu.percent,
    cpuModel: cpu.model ?? '',
    cpuCores: cpu.num ?? 0,
    cpuTemperature: cpu.temperature ?? null,
    /**
     * The RAW counter, not watts. Named for what it is.
     *
     * 🔴 Measured 2026-07-30: `power.value` grows monotonically — 12 068 790 514 then
     * 12 093 174 668 four seconds later. That is a cumulative **energy** counter in
     * microjoules (RAPL), and the difference over time is the power: 24 384 154 µJ / 4.013 s
     * = 6.1 W, which is what an idle i7-1360P actually draws. The dashboard was printing the
     * counter itself and labelling it "W" — "10251150514 W". Not wrong by a factor: a
     * different kind of quantity altogether.
     */
    cpuEnergyMicrojoules: finiteOrNull(cpu.power?.value),
    cpuPowerTimestamp: finiteOrNull(cpu.power?.timestamp),
    cpuPowerWatt: derivePowerWatt(
      finiteOrNull(cpu.power?.value),
      finiteOrNull(cpu.power?.timestamp),
    ),
    memoryTotal: mem.total,
    memoryUsed: mem.used,
    memoryPercent: mem.usedPercent,
    systemDiskSize: disk?.size ?? 0,
    systemDiskUsed: disk?.used ?? 0,
    systemDiskHealthy: disk?.health ?? true,
  })
}

/**
 * live: GET /v2/zimaos/device/info -> `{arch,cpu:{cores,frequency,model,threads},…}` with
 * no envelope. The names below are the fields we rely on; anything else is passed over.
 */
const deviceInfoSchema = z.looseObject({
  arch: z.string().optional(),
  device_name: z.string().optional(),
  hostname: z.string().optional(),
  device_model: z.string().optional(),
  model: z.string().optional(),
  os_version: z.string().optional(),
  cpu: z
    .looseObject({ model: z.string().optional(), cores: z.number().optional() })
    .optional(),
  memory: z.looseObject({ total: z.number().optional() }).optional(),
})

export const readDeviceInfo = async (ctx: DeviceContext): Promise<Result<DeviceInfo>> => {
  const answer = await authed<unknown>(ctx, `${BASE.zimaos}${SYSTEM.deviceInfo}`)
  if (isErr(answer)) return answer
  const parsed = parse(deviceInfoSchema, answer.value, 'device info')
  if (isErr(parsed)) return parsed
  const raw = parsed.value
  return ok({
    // Several name fields exist and not all are filled on every device; the first
    // non-empty one wins and an empty result stays empty rather than becoming "unknown",
    // which the UI would print as if the device had said it.
    name: raw.device_name ?? raw.hostname ?? '',
    model: raw.device_model ?? raw.model ?? '',
    osVersion: raw.os_version ?? '',
    arch: raw.arch ?? '',
    cpuModel: raw.cpu?.model ?? '',
    cpuCores: raw.cpu?.cores ?? 0,
    memoryTotal: raw.memory?.total ?? 0,
  })
}

/**
 * live: GET /v2/local_storage/storages?all=true -> a bare array
 * `[{name,path,type,extensions:{size,used,health}}]`.
 *
 * `/v2/local_storage/storage/stats` also answers 200 but returns two JSON-encoded STRINGS,
 * which would have to be parsed a second time — the volume list carries the same numbers
 * already typed, so this is the honest source.
 */
const volumeSchema = z.looseObject({
  name: z.string(),
  path: z.string(),
  type: z.string().optional(),
  extensions: z
    .looseObject({
      size: z.number().optional(),
      used: z.number().optional(),
      health: z.boolean().optional(),
    })
    .optional(),
})

export const listVolumes = async (
  ctx: DeviceContext,
): Promise<Result<readonly StorageVolume[]>> => {
  const answer = await authed<unknown>(ctx, `${BASE.localStorage}${STORAGE.storages}`, {
    query: { all: 'true' },
  })
  if (isErr(answer)) return answer
  const parsed = parse(z.array(volumeSchema).nullable(), answer.value, 'storage volumes')
  if (isErr(parsed)) return parsed
  return ok(
    (parsed.value ?? []).map((raw) => ({
      name: raw.name,
      path: raw.path,
      type: raw.type ?? '',
      sizeBytes: raw.extensions?.size ?? 0,
      usedBytes: raw.extensions?.used ?? 0,
      healthy: raw.extensions?.health ?? true,
    })),
  )
}

/**
 * Restarts or powers off the device.
 *
 * sdk: **PUT** `/v1/sys/state/{restart|off}`, the two values the shipped UI uses behind its
 * own confirmation dialog. This is the one endpoint in the client whose status is
 * deliberately unmeasured — running the probe would have shut the device down — so the code
 * says that plainly instead of carrying a comment that implies a measurement.
 *
 * The caller is responsible for the confirmation; this function does not ask.
 */
export const setSystemState = async (
  ctx: DeviceContext,
  action: SystemStateAction,
): Promise<Result<void>> => {
  const answer = await authed<unknown>(ctx, `${BASE.sys}${systemState(action)}`, {
    method: 'PUT',
    // A device that is shutting down may never answer. A short timeout that is treated as
    // success would be a lie, so the timeout is generous and a timeout stays an error —
    // the UI then says "no confirmation received", which is the truth.
    timeoutMs: 15_000,
  })
  return isErr(answer) ? answer : ok(undefined)
}
