/**
 * Phase-0 evidence tool: proves discovery, probing and capability detection against
 * real devices. Prints what was measured, never what was assumed.
 */
import { discover } from '../src/main/discovery/mdns.ts'
import { probe } from '../src/main/transport/probe.ts'
import { fetchRoutes } from '../src/main/zima/client.ts'
import { deriveCapabilities, parseRoutes } from '../src/main/zima/capabilities.ts'
import { isOk } from '../src/shared/result.ts'

const devices = await discover(3500)
console.log(`mDNS _zimaos._tcp: ${devices.length} Antwort(en)`)
for (const d of devices) {
  console.log(`  ${d.name}  port=${d.port}  txt=${JSON.stringify(d.txt)}  host=${d.host.replace(/\.\d+$/, '.x')}`)
}
if (devices.length === 0) {
  console.log('  (leer heisst: nichts hat geantwortet — NICHT "kein Gerät vorhanden")')
}

for (const d of devices) {
  const p = await probe(d.host, d.port)
  const routes = await fetchRoutes(d.host, d.port)
  let caps = 'n/a'
  if (isOk(routes)) {
    const paths = parseRoutes(routes.value)
    if (paths) {
      const c = deriveCapabilities(paths)
      caps = `routes=${paths.length} photoLibrary=${c.photoLibrary} photoBrowse=${c.photoBrowse} photoBackup=${c.photoBackup} apps=${c.apps} power=${c.systemPower}`
    }
  }
  console.log(`\n${d.name}: reachable=${p.reachable} latency=${p.latencyMs}ms failure=${p.failure ?? '-'}`)
  console.log(`  ${caps}`)
}

// Negativkontrollen. Port 9 waere ungueltig: Node lehnt WHATWG-"bad ports" ab,
// ohne einen Socket zu oeffnen — das messe man nicht als Netzwerkzustand.
const refused = await probe('127.0.0.1', 45999)
console.log(`\nNegativkontrolle 127.0.0.1:45999 (nichts lauscht) -> failure=${refused.failure}  (erwartet: refused)`)

const dropped = await probe('192.0.2.1', 80, 1200) // TEST-NET-1, per RFC 5737 nicht geroutet
console.log(`Negativkontrolle 192.0.2.1:80 (nicht geroutet)      -> failure=${dropped.failure}  (erwartet: timeout)`)
