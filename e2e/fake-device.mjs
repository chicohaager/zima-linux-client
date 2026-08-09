import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'

/**
 * Brings up the replayed ZimaOS on port 80 and proves it is the one answering.
 *
 * Port 80 is not negotiable: the client has no port field, its UI always connects on 80. Two
 * ways exist to get there without being root, and the choice is made by MEASUREMENT rather
 * than by guessing the environment:
 *
 *  1. bind :80 directly — works where `net.ipv4.ip_unprivileged_port_start` has been lowered,
 *     which is what the CI workflow does in one line;
 *  2. otherwise publish it through Docker (`-p 127.0.0.1:80:80`), which needs no privilege of
 *     ours because the daemon does the binding.
 *
 * 🔴 Whichever path is taken, the server is CHALLENGED before any test runs: a marker
 * endpoint must answer with this process's own nonce. A port that answers is not evidence
 * that the server I started is the one answering it — on 2026-08-08 a dev server failed to
 * start, an unrelated container held the port, `curl` said 200, and the page looked plausible
 * enough to have been reported as a finding.
 *
 * Plain `.mjs` on purpose: it is Node-side test scaffolding, and the repository's editor
 * validator type-checks `.ts` against a browser target, where `node:http` does not exist.
 * The types live in `fake-device.d.ts` next door.
 */

const execFileAsync = promisify(execFile)

export const FAKE_HOST = '127.0.0.1'
const FIXTURE = 'e2e/fixtures/zimaos-session.json'
const CONTAINER = 'zima-e2e-fake'

export const credentials = JSON.parse(readFileSync(FIXTURE, 'utf8')).credentials

const canBindPort80 = async () =>
  new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(80, '127.0.0.1', () => probe.close(() => resolve(true)))
  })

const waitForAnswer = async (nonce, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs
  let lastError = 'never answered'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${FAKE_HOST}/__nonce`)
      const body = (await response.text()).trim()
      if (body === nonce) return
      // Answering with someone else's nonce is the case this exists for.
      lastError = `something else is on port 80 (it replied ${JSON.stringify(body.slice(0, 80))})`
    } catch (cause) {
      lastError = String(cause)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`the fake device never identified itself on port 80: ${lastError}`)
}

export const startFakeDevice = async () => {
  // A value this run owns. Nothing else on the machine can produce it.
  const nonce = `zima-e2e-${process.pid}-${process.hrtime.bigint().toString(36)}`
  const served = async () => (await (await fetch(`http://${FAKE_HOST}/__served`)).json())

  if (await canBindPort80()) {
    const child = spawn(process.execPath, ['e2e/fake-zimaos.mjs'], {
      env: { ...process.env, ZIMA_FIXTURE: FIXTURE, ZIMA_FAKE_NONCE: nonce },
      stdio: 'inherit',
    })
    let exited = null
    child.on('exit', (code) => {
      exited = code
    })
    try {
      await waitForAnswer(nonce)
    } catch (cause) {
      // A failed start is otherwise silent: the process dies, the port stays free or is held
      // by someone else, and the first test reports a confusing UI error instead.
      throw new Error(`${String(cause)} (the fake process exited with ${String(exited)})`)
    }
    return {
      mode: 'direct',
      served,
      stop: async () => {
        child.kill('SIGTERM')
      },
    }
  }

  await execFileAsync('docker', ['rm', '-f', CONTAINER]).catch(() => undefined)
  await execFileAsync('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    CONTAINER,
    '-p',
    '127.0.0.1:80:80',
    '-e',
    'ZIMA_FIXTURE=/app/fixtures/zimaos-session.json',
    '-e',
    `ZIMA_FAKE_NONCE=${nonce}`,
    '-v',
    `${process.cwd()}/e2e:/app:ro`,
    'node:22-alpine',
    'node',
    '/app/fake-zimaos.mjs',
  ])
  await waitForAnswer(nonce)
  return {
    mode: 'docker',
    served,
    stop: async () => {
      await execFileAsync('docker', ['rm', '-f', CONTAINER]).catch(() => undefined)
    },
  }
}
