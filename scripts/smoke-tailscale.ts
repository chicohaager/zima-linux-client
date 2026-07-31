/**
 * Reads the local Tailscale state through the real detector — Plan § 3b.
 *
 * Run: npx vite-node -c vitest.config.ts scripts/smoke-tailscale.ts
 *
 * A unit test proves the parsing against a recorded answer; this proves the detector can
 * actually reach the daemon on this machine, as this user, without privilege. Those are
 * different claims and the fixture cannot make the second one.
 *
 * Nothing is started, stopped or configured. Detection only — see the note at the top of
 * `src/main/tailscale/detect.ts` for why that boundary matters.
 */
import { isErr } from '../src/shared/result'
import { candidateAddresses, readRuntime } from '../src/main/tailscale/detect'
import { probe } from '../src/main/transport/probe'

const result = await readRuntime()

if (isErr(result)) {
  console.error(`FAIL  ${result.error.kind}: ${result.error.message}`)
  process.exit(1)
}

const runtime = result.value
console.log(`installed      ${runtime.installed}`)
console.log(`backendState   ${runtime.backendState ?? '(none)'}`)
console.log(`tailnet        ${runtime.tailnetName ?? '(none)'}`)
console.log(`magicDNS       ${runtime.magicDnsSuffix ?? '(none)'}`)
console.log(`self           ${runtime.selfAddresses.join(', ') || '(none)'}`)
console.log(`problem        ${runtime.problem ?? '(none)'}`)
console.log(`peers          ${runtime.peers.length}`)
for (const peer of runtime.peers) {
  console.log(
    `  ${peer.online ? 'up  ' : 'down'} ${peer.hostName.padEnd(30)} ${peer.addresses[0]}  (${peer.os})`,
  )
}
const candidates = candidateAddresses(runtime)
console.log(`\ncandidates for the probe: ${candidates.join(', ') || '(none)'}`)

if (!runtime.installed) {
  console.log('\nTailscale is not installed here — that is a state, not a failure.')
  process.exit(0)
}

/*
 * The part that matters: which of these actually IS a ZimaOS device.
 *
 * Seeing a peer proves the tunnel is up, not that the client can use it — reachability is
 * not fitness. The probe asks each candidate for the gateway route table, which is the same
 * qualification LAN and direct-IP addresses go through. A peer named "ZimaOS" that fails
 * here is not a device; a peer named "homeassistant" that passes would be one.
 */
console.log('\nprobing each candidate (gateway route table, the same check as LAN):')
const probed = await Promise.all(candidates.map(async (host) => probe(host)))
for (const result of probed) {
  console.log(
    result.reachable
      ? `  ZimaOS   ${result.host.padEnd(18)} ${result.latencyMs}ms`
      : `  no       ${result.host.padEnd(18)} ${result.failure}`,
  )
}
const usable = probed.filter((result) => result.reachable)
console.log(
  `\n${usable.length} of ${candidates.length} peer(s) answer as ZimaOS over Tailscale` +
    `${usable.length > 0 ? ` — fastest ${usable.sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0))[0]?.host}` : ''}`,
)
