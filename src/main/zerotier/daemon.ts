import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { appError, err, fromUnknown, ok, type Result } from '@shared/result'
import { logger } from '@main/logging/logger'
import { diagnoseJoin } from './diagnosis'
import { isNetworkId } from './networkId'
import { hasNetAdmin, managedBinaryPath } from './provision'
import {
  canEscapeProcessTree,
  processHasNetAdmin,
  serviceLog,
  servicePid,
  startService,
  stopService,
} from './supervisor'

/**
 * ZeroTier — the third connection route, "Remote ID" (Plan § 3b).
 *
 * Measured on this machine 2026-07-30 against a running user-mode daemon:
 *
 *   ~/.zima-zerotier/zerotier-one.port      -> 9995        (the daemon writes its own port)
 *   ~/.zima-zerotier/authtoken.secret       -> 24 chars    (the local API credential)
 *   GET  http://127.0.0.1:9995/status       -> {address:"4976ce6088", online, config:{…}}
 *   GET  http://127.0.0.1:9995/network      -> [{id, nwid, name, status:"OK", assignedAddresses}]
 *   header: X-ZT1-Auth: <authtoken.secret>
 *
 * Design decisions worth stating:
 *
 *  - **User mode, own home directory.** The system `zerotier-one.service` keeps its auth
 *    token in `/var/lib/zerotier-one`, readable only by root. A client that needed root to
 *    show a connection state would either ask for a password or fail — so it runs its own
 *    daemon with `-U` and a home directory under `userData`, which is what the 0.9 line did
 *    and what actually works unprivileged.
 *  - **No background daemon.** The child is supervised and stopped when the app quits. This
 *    client has no background mode (same reason photo backup has none), and leaving a
 *    network daemon behind after the window closes would be exactly that.
 *  - **Never a guessed state.** If the port file, the token or the API is missing, the answer
 *    carries `problem` with the reason. "Not connected" and "I could not find out" are
 *    different statements, and only one of them is worth acting on.
 */

export interface ZerotierNetwork {
  readonly networkId: string
  readonly name: string
  /** Verbatim from the daemon: OK, REQUESTING_CONFIGURATION, ACCESS_DENIED, NOT_FOUND. */
  readonly status: string
  /** PUBLIC or PRIVATE. Only a PRIVATE network needs the controller to authorise a node. */
  readonly type: string
  readonly assignedAddresses: readonly string[]
  /** Managed routes, e.g. `<x.y>.0.0/16`. The device's address is derived from these. */
  readonly routeTargets: readonly string[]
}

export interface ZerotierRuntime {
  readonly daemon: 'managed' | 'system' | 'bundled' | 'absent'
  readonly running: boolean
  readonly nodeId: string | null
  readonly networks: readonly ZerotierNetwork[]
  readonly problem: string | null
}

/**
 * 9997, not 9993 or 9995.
 *
 * 9993 belongs to a system-wide daemon and 9995 is what the 0.9 client used — binding either
 * would either fail or, worse, appear to work while talking to somebody else's daemon and
 * report its networks as ours.
 */
const DEFAULT_PORT = 9_997

const homeDir = (): string => join(app.getPath('userData'), 'zerotier')

/** Transient `systemd --user` unit name. Fixed, so a leftover can be found and stopped. */
const UNIT = 'zima-linux-client-zerotier'

let child: ChildProcess | null = null

/**
 * How the daemon was last launched — and therefore whether file capabilities apply to it.
 *
 * Not cosmetic. A daemon started as our child inherits `no_new_privs` and runs with
 * `CapEff: 0` no matter what `getcap` says about the file, so "the binary has the
 * capability" and "the running daemon has the capability" are different claims. Keeping the
 * route lets the diagnosis name the right one instead of pointing at a file that is fine.
 */
let launchedVia: 'systemd-user' | 'child' | null = null

/**
 * Whether the daemon that is actually running holds CAP_NET_ADMIN.
 *
 * Asks the process, never the file. The unit is consulted even when this app has no record
 * of starting it — a previous run that was killed rather than quit leaves it behind, and
 * "I did not start it" is not evidence about what is running.
 */
const runningDaemonHasNetAdmin = async (): Promise<boolean | null> => {
  if (child?.pid !== undefined) return processHasNetAdmin(child.pid)
  const pid = await servicePid(UNIT)
  return pid === null ? null : processHasNetAdmin(pid)
}

/**
 * The daemon's last complaint, kept so a failure can say what the daemon said.
 *
 * Without this the only evidence was "exited, code 0" — technically true and useless. The
 * daemon knows exactly what is wrong and writes it to stderr; the job here is to not throw
 * that away between the pipe and the user.
 */
let lastDaemonError: string | null = null

/** Read through a function so the checker cannot narrow it away across an await. */
const daemonComplaint = (): string | null => lastDaemonError

/**
 * Whether a binary may create a TUN device unprivileged.
 *
 * 🔴 A STABLE witness, unlike the daemon's stderr. Tying the diagnosis to that message was
 * wrong: it appears once, at start-up, and a join attempted against an already-running
 * daemon therefore saw nothing and fell back to the useless "joined but not listed".
 * Capabilities can be read at any time and answer the same question.
 *
 * Returns null when `getcap` is unavailable — "I could not find out" is not "it has none".
 */


/**
 * A daemon that cannot create its virtual network device.
 *
 * 🔴 Measured 2026-07-30: an unprivileged `zerotier-one` prints
 * `unable to configure TUN/TAP device for TAP operation`, then reports a join as accepted
 * while never actually being in the network — so the join looks fine and the member list
 * stays empty. Creating a TUN device needs CAP_NET_ADMIN; the 0.9 client solved this by
 * shipping its own binary with `setcap cap_net_admin,cap_net_raw,cap_net_bind_service+eip`,
 * which is still present on this machine and still works. The system binary at
 * /usr/sbin/zerotier-one has no capabilities because systemd runs it as root, and its API
 * token is root-only — measured: not readable even as a member of group `zerotier-one`.
 */
/**
 * The binary to run as OUR unprivileged daemon.
 *
 * 🔴 Order reversed on 2026-07-30. This used to prefer `/usr/sbin/zerotier-one`, which is
 * exactly the wrong choice for an unprivileged daemon: the distribution's binary carries no
 * capabilities (systemd runs it as root), so it cannot create a TUN device — it accepted a
 * network join and never entered the network. Our own copy can be granted the capability
 * without touching a file the distribution owns.
 *
 * The system binary stays as the last resort: on a machine where it HAS been given
 * capabilities, it works, and refusing to use it then would be pedantry.
 */
export const locateBinary = (): { path: string; origin: 'managed' | 'system' | 'bundled' } | null => {
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'zerotier', process.arch, 'zerotier-one')
    : join(app.getAppPath(), 'bin', 'zerotier', process.arch, 'zerotier-one')

  const candidates = [
    { path: managedBinaryPath(), origin: 'managed' as const },
    { path: bundled, origin: 'bundled' as const },
    { path: '/usr/sbin/zerotier-one', origin: 'system' as const },
    { path: '/usr/bin/zerotier-one', origin: 'system' as const },
  ].filter((candidate) => existsSync(candidate.path))

  /*
   * 🔴 Chosen by the property that matters, not by where the file sits.
   *
   * A fixed preference order was wrong in both directions within one day: it first picked
   * the system binary, which can never have capabilities because systemd runs it as root;
   * reversing it then made it pick our own copy even when the `.deb` had already granted the
   * capability to the packaged one — `copyFileSync` does not carry extended attributes, so
   * the copy in ~/.local is exactly the one that has *lost* the grant.
   *
   * What the daemon needs is CAP_NET_ADMIN. So that is what gets asked. The location order
   * survives only as the tiebreak for when nothing is capable and something has to be tried.
   */
  const capable = candidates.find((candidate) => hasNetAdmin(candidate.path) === true)
  return capable ?? candidates[0] ?? null
}

const readPort = (): number => DEFAULT_PORT

/**
 * A port file naming somebody else's daemon. Null when there is nothing to report.
 *
 * Kept as a diagnosis rather than acted upon — the user needs to know that the stale file
 * is there, because it is the reason a previous version pointed at the wrong service.
 */
const foreignPortFile = (): number | null => {
  try {
    const raw = readFileSync(join(homeDir(), 'zerotier-one.port'), 'utf8').trim()
    const port = Number.parseInt(raw, 10)
    return Number.isInteger(port) && port > 0 && port !== DEFAULT_PORT ? port : null
  } catch {
    return null
  }
}

const readToken = (): string | null => {
  try {
    const token = readFileSync(join(homeDir(), 'authtoken.secret'), 'utf8').trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

const callApi = async <T>(path: string, init: RequestInit = {}): Promise<Result<T>> => {
  const token = readToken()
  if (token === null) {
    return err(
      appError('internal', 'zerotier auth token not readable', 'error.zerotierNoToken', {
        home: homeDir(),
      }),
    )
  }
  try {
    const response = await fetch(`http://127.0.0.1:${readPort()}${path}`, {
      ...init,
      headers: { 'X-ZT1-Auth': token, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) {
      return err(
        appError('unexpected-status', `zerotier api HTTP ${response.status}`, 'error.zerotierApi', {
          path,
          status: response.status,
        }),
      )
    }
    const text = await response.text()
    return ok((text.length === 0 ? null : JSON.parse(text)) as T)
  } catch (cause) {
    return err(fromUnknown(cause, { path }))
  }
}

interface RawNetwork {
  readonly nwid?: unknown
  readonly id?: unknown
  readonly name?: unknown
  readonly status?: unknown
  readonly type?: unknown
  readonly assignedAddresses?: unknown
  readonly routes?: unknown
}

const toNetwork = (raw: RawNetwork): ZerotierNetwork => ({
  networkId: typeof raw.nwid === 'string' ? raw.nwid : typeof raw.id === 'string' ? raw.id : '',
  name: typeof raw.name === 'string' ? raw.name : '',
  // Passed through verbatim. ACCESS_DENIED means the network's controller has not authorised
  // this node — the user has to approve it, and only the real word tells them that.
  status: typeof raw.status === 'string' ? raw.status : 'UNKNOWN',
  /**
   * PUBLIC or PRIVATE, verbatim from the daemon.
   *
   * 🔴 Read because whether a join needs approval depends entirely on this, and the UI used
   * to claim it always does. Measured 2026-07-30 on this machine: all six
   * `IceWhale-RemoteAccess` memberships are **PUBLIC** with `status: OK` — nobody authorised
   * anything, and the interface told the user to wait for an approval that was never coming.
   * A general truth about ZeroTier ("the owner must authorise the node") stated without its
   * scope becomes false at the one place it gets read.
   */
  type: typeof raw.type === 'string' ? raw.type : 'UNKNOWN',
  assignedAddresses: Array.isArray(raw.assignedAddresses)
    ? raw.assignedAddresses.filter((entry): entry is string => typeof entry === 'string')
    : [],
  routeTargets: Array.isArray(raw.routes)
    ? raw.routes
        .map((route) => (route as { target?: unknown }).target)
        .filter((target): target is string => typeof target === 'string')
    : [],
})

/**
 * Where the ZimaOS device sits inside its own remote-access network.
 *
 * ZimaOS runs the controller for its network and takes the first host address, so a route
 * of `<x.y>.0.0/16` puts the device at `<x.y>.0.1`. Two independent measurements on
 * 2026-07-30 agree: the 0.9 client derived exactly this and worked, and the device's own
 * `GET /v2/zimaos/zt/info` reports `ip: <x.y.0.1>` for network `<remote-id>`.
 *
 * It stays a CANDIDATE regardless. The device cannot be asked before we can reach it — that
 * is the whole point of this route — so the address is derived and then **probed**, exactly
 * like an mDNS hit or a typed IP. If ZimaOS ever numbers a network differently, the probe
 * fails and says so instead of the client insisting on a host that is not there.
 */
export const deviceCandidates = (network: ZerotierNetwork): readonly string[] =>
  network.routeTargets
    .map((target) => /^(\d+\.\d+\.\d+)\.\d+\/\d+$/.exec(target))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]}.1`)

/** Reads the current state. Never starts anything — a status query must not change the system. */
export const readRuntime = async (): Promise<ZerotierRuntime> => {
  const binary = locateBinary()
  const origin = binary?.origin ?? 'absent'

  const status = await callApi<{ address?: unknown; online?: unknown }>('/status')
  if (!status.ok) {
    const stale = foreignPortFile()
    // 401 means a ZeroTier IS listening on our port and rejected our token — that is a
    // different fact from "nothing is running", and saying the latter sent a user looking
    // for a stopped service that was never stopped. `refused` is the one that means off.
    const otherDaemon =
      status.error.kind === 'unexpected-status' && status.error.context?.['status'] === 401
    return {
      daemon: origin,
      running: false,
      nodeId: null,
      networks: [],
      // The reason travels with the answer. Without it the UI could only say "off", and a
      // missing token would look identical to a stopped daemon.
      problem:
        (otherDaemon
          ? `another ZeroTier daemon answers on port ${readPort()} and rejects our token ` +
            `(HTTP 401) — ours is not the one running there`
          : `${status.error.kind}: ${status.error.message}`) +
        (stale === null
          ? ''
          : `; a stale zerotier-one.port in our home names port ${stale} and is ignored`),
    }
  }

  const networks = await callApi<RawNetwork[] | null>('/network')
  return {
    daemon: origin,
    running: true,
    nodeId: typeof status.value.address === 'string' ? status.value.address : null,
    networks: (networks.ok ? (networks.value ?? []) : []).map(toNetwork),
    problem: networks.ok ? null : `networks unreadable: ${networks.error.kind}`,
  }
}

/**
 * Starts the local daemon if it is not answering.
 *
 * Runs in the foreground as a supervised child, not with `-d`: a daemonised process would
 * outlive the app and keep the machine on a network the user believes they left.
 */
export const ensureRunning = async (): Promise<Result<ZerotierRuntime>> => {
  const before = await readRuntime()
  if (before.running) {
    /*
     * 🔴 Running is not the same as able.
     *
     * Measured 2026-07-30, the first time the capability was actually granted: the daemon
     * had been started 84 seconds earlier and kept `CapEff: 0000000000000000`, because
     * capabilities are applied by `execve` and a live process never acquires them
     * afterwards. `getcap` on the file said yes, the process said no, and this function
     * returned "already running" — so the grant appeared to do nothing at all.
     *
     * A daemon that answers but cannot create a network device is replaced, once, and only
     * when the binary would give it something it currently lacks. Restarting on any doubt
     * would drop live networks for no reason; `null` from either check means "could not
     * find out" and is deliberately not a reason to act.
     */
    const capableNow = await runningDaemonHasNetAdmin()
    const binaryCapable = hasNetAdmin(locateBinary()?.path ?? '')
    if (capableNow === false && binaryCapable === true) {
      logger.info('zerotier.restart-for-capability', { reason: 'running daemon predates the grant' })
      await stopService(UNIT)
      if (child !== null) {
        child.kill('SIGTERM')
        child = null
      }
      // The port has to actually free up before a new daemon can bind it; polled rather
      // than slept-and-hoped.
      for (let attempt = 0; attempt < 20 && (await readRuntime()).running; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
      }
    } else {
      return ok(before)
    }
  }

  const binary = locateBinary()
  if (binary === null) {
    return err(
      appError('capability-missing', 'no zerotier-one binary found', 'error.zerotierMissing'),
    )
  }

  try {
    mkdirSync(homeDir(), { recursive: true, mode: 0o700 })
  } catch (cause) {
    return err(fromUnknown(cause, { home: homeDir() }))
  }

  // Argument array, never a shell string (project rule): a home directory with a space in it
  // would otherwise split into two arguments.
  const argv = [binary.path, `-p${String(DEFAULT_PORT)}`, '-U', homeDir()]

  /*
   * 🔴 Launched OUTSIDE this process tree when at all possible.
   *
   * Measured 2026-07-30: the Electron main process runs with `NoNewPrivs: 1`, which the
   * kernel inherits into every child and which makes it **ignore file capabilities on
   * exec**. Our daemon, spawned here as a child, was running with `CapEff: 0` — so the
   * whole "give our own binary CAP_NET_ADMIN" plan could never have worked from this side,
   * however correctly the capability was set. The 0.9 client escapes it by having
   * `systemd --user` start its daemon, and that is what this does.
   *
   * See supervisor.ts for the positive control, which had to be run from a caller that
   * already had the flag set — from a clean shell it proves nothing about our case.
   */
  if (await canEscapeProcessTree()) {
    const started = await startService(UNIT, argv, 'ZeroTier for ZimaOS Client')
    if (!started.ok) return started
    launchedVia = 'systemd-user'
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250))
      const runtime = await readRuntime()
      if (runtime.running) return ok(runtime)
    }
    // A unit that never answered still wrote its reason to the journal. Fetched rather
    // than replaced with "did not start", which is the symptom and not the cause.
    const journal = await serviceLog(UNIT)
    if (journal !== null && journal.includes('ERROR')) lastDaemonError = journal.slice(-300)
    return err(
      appError(
        'timeout',
        `zerotier daemon did not answer within 5s${journal === null ? '' : ` — journal: ${journal.slice(-300)}`}`,
        'error.zerotierNoStart',
        { home: homeDir(), via: 'systemd-user' },
      ),
    )
  }

  // No `systemd --user` — a container, a sandbox, or a machine without systemd. The daemon
  // still runs, and on a host where `no_new_privs` is NOT set it works; where it is, the
  // capability cannot take effect and `joinBlockedReason` says exactly that instead of
  // blaming the file.
  launchedVia = 'child'
  /*
   * 🔴 The port is APPENDED to the switch, and the home directory is POSITIONAL.
   *
   * This was `['-p', '9997', '-U', home]` and the daemon exited 16 ms later with code 0.
   * Measured 2026-07-30 by running it by hand: it prints its usage banner —
   * `Usage: /usr/sbin/zerotier-one [-switches] [home directory]` — because `-p 9997` with a
   * space is not a recognised switch. `-p9997` runs. The 0.9 client had it right all along
   * (`-p9995 -d -U <home>`); this was a transcription error, not a discovery.
   *
   * The project rule "argument array, never a shell string" was followed and did not help:
   * it protects against quoting bugs, not against wrong arguments.
   */
  child = spawn(binary.path, argv.slice(1), {
    // NOT 'ignore'. The exit above said only "code 0" while the daemon was printing the
    // exact reason to stdout — a diagnosis thrown away at the moment it was produced. This
    // one silent pipe cost the whole Remote-ID route.
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })
  const remember = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text.length === 0) return
    logger.info(`zerotier.daemon-${stream}`, { text: text.slice(0, 300) })
    if (text.includes('ERROR')) lastDaemonError = text.slice(0, 300)
  }
  child.stdout?.on('data', remember('stdout'))
  child.stderr?.on('data', remember('stderr'))
  child.on('exit', (code, signal) => {
    logger.warn('zerotier.daemon-exited', { code, signal })
    child = null
  })
  logger.info('zerotier.daemon-started', { binary: binary.path, origin: binary.origin, port: DEFAULT_PORT })

  // The daemon needs a moment to write its port file and open the API. Polled rather than
  // slept-then-assumed, so a slow start is waited out and a failed start is reported.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    const runtime = await readRuntime()
    if (runtime.running) return ok(runtime)
  }
  return err(
    appError('timeout', `zerotier daemon did not answer within 5s${lastDaemonError === null ? '' : ` — it reported: ${lastDaemonError}`}`, 'error.zerotierNoStart', {
      home: homeDir(),
    }),
  )
}

/**
 * Guard for the two functions that put an id into a URL path.
 *
 * Checked HERE, in the module that builds the request, not only in the two callers that
 * happen to check today. Both of them do — the IPC schema and `remoteIdStrategy` — and that
 * is precisely the arrangement that rots: the guarantee lives somewhere else, so the third
 * caller inherits an assumption nobody restated.
 */
const rejectBadId = (networkId: string): Result<never> | null =>
  isNetworkId(networkId)
    ? null
    : err(
        // `error.invalidRequest` rather than a new key: this guard should never fire in
        // normal use, so the honest message is that the request was rejected before it was
        // sent because this client built it wrong.
        appError('parameters', `not a ZeroTier network id: ${networkId.slice(0, 24)}`,
          'error.invalidRequest', { length: networkId.length }),
      )

export const joinNetwork = async (networkId: string): Promise<Result<ZerotierRuntime>> => {
  const bad = rejectBadId(networkId)
  if (bad !== null) return bad
  lastDaemonError = null
  const started = await ensureRunning()
  if (!started.ok) return started
  const joined = await callApi<unknown>(`/network/${networkId}`, { method: 'POST', body: '{}' })
  if (!joined.ok) return joined
  logger.info('zerotier.joined', { networkId })
  // A join is ACCEPTED by a daemon that cannot actually enter the network. Saying so here,
  // once, beats letting the caller puzzle over an empty member list — this is the "the
  // store accepted my request" trap: the answer comes from the side that takes the request,
  // not the side that does the work.

  // The state is read back rather than assumed: a join answers 200 long before the
  // controller has authorised the node, and 'OK' vs 'ACCESS_DENIED' is the difference
  // between "connected" and "waiting for approval".
  //
  // Polled, because the membership appears in `/network` a moment after the POST returns.
  // Reading once and reporting "the daemon does not list it" would turn a race into a
  // diagnosis — and that message is a symptom, not a cause, so it is worth not producing it
  // by accident.
  let runtime = await readRuntime()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (runtime.networks.some((network) => network.networkId === networkId)) break
    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    runtime = await readRuntime()
  }
  return ok(runtime)
}

/**
 * Why a join can be accepted and still not take effect. Null when nothing is known to be
 * wrong — the caller then reports the plain fact rather than a guessed cause.
 *
 * Gathers the facts here (this is where the measuring mistakes were made and where they must
 * stay visible) and leaves the choice of message to `diagnosis.ts`, which is testable.
 */
export const joinBlockedReason = async (): Promise<string | null> => {
  const binary = locateBinary()
  if (binary === null) return null
  /*
   * 🔴 The RUNNING daemon is asked, not the binary.
   *
   * This used to call `hasNetAdmin(binary.path)`. The moment the capability was granted for
   * the first time, that check went green while the live daemon — started before the grant —
   * still had `CapEff: 0`. The real cause was invisible and the user got the generic
   * "joined but the daemon does not list it", which names the symptom and nothing else.
   */
  return diagnoseJoin({
    capable: (await runningDaemonHasNetAdmin()) ?? hasNetAdmin(binary.path),
    complaint: daemonComplaint(),
    launchedVia,
    managedBinary: managedBinaryPath(),
  })
}

export const leaveNetwork = async (networkId: string): Promise<Result<ZerotierRuntime>> => {
  const bad = rejectBadId(networkId)
  if (bad !== null) return bad
  const left = await callApi<unknown>(`/network/${networkId}`, { method: 'DELETE' })
  if (!left.ok) return left
  logger.info('zerotier.left', { networkId })
  return ok(await readRuntime())
}

/**
 * Stops the daemon, whichever way it was started. Called on app quit — there is no
 * background mode, and a network daemon left running after the window closes would be one.
 *
 * The transient unit is stopped unconditionally, not only when we believe we started it: a
 * previous run that was killed rather than quit leaves the unit behind, and "I have no
 * record of starting it" is not evidence that it is not running.
 */
export const stopDaemon = (): void => {
  if (child !== null) {
    logger.info('zerotier.daemon-stopping', {})
    child.kill('SIGTERM')
    child = null
  }
  launchedVia = null
  // Fire-and-forget: quit handlers do not get to await, and a stop that lands a moment
  // later still lands. The failure path inside stopService is already silent-by-design for
  // "there was nothing to stop".
  void stopService(UNIT)
}
