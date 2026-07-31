import { describe, expect, it } from 'vitest'
import { diagnoseJoin, TUN_FAILURE } from '../diagnosis'

/**
 * These are the two wrong answers this code has already given on a real machine, now written
 * down as tests:
 *
 *  1. accusing the binary when the process tree was the problem — the user grants a capability
 *     that the kernel then ignores, and nothing changes,
 *  2. producing a cause from "could not determine", which reads as a diagnosis and is a guess.
 */

const BINARY = '/home/user/.local/lib/zima/zerotier/zerotier-one'

const facts = (over: Partial<Parameters<typeof diagnoseJoin>[0]> = {}): Parameters<typeof diagnoseJoin>[0] => ({
  capable: true,
  complaint: null,
  launchedVia: 'systemd-user',
  managedBinary: BINARY,
  ...over,
})

describe('diagnoseJoin', () => {
  it('says nothing when the daemon is capable and silent', () => {
    // Nothing known to be wrong must produce NO cause: an invented one would send the caller
    // past the real reason, which is usually "the network owner has not authorised this node".
    expect(diagnoseJoin(facts())).toBeNull()
  })

  it('says nothing when capability could not be determined', () => {
    // null is "I could not find out". Treating it as false is how a working setup gets
    // accused — the same mistake as reading a missing name as a missing feature.
    expect(diagnoseJoin(facts({ capable: null }))).toBeNull()
  })

  it('blames the process tree when the daemon runs as our child', () => {
    const reason = diagnoseJoin(facts({ capable: false, launchedVia: 'child' }))
    expect(reason).toMatch(/no_new_privs/)
    // It must NOT tell the user to grant a capability here: they would type their password
    // for a change the kernel ignores on exec.
    expect(reason).not.toContain(BINARY)
    expect(reason).not.toMatch(/needs CAP_NET_ADMIN/)
  })

  it('names the binary when the daemon runs outside our process tree', () => {
    const reason = diagnoseJoin(facts({ capable: false, launchedVia: 'systemd-user' }))
    expect(reason).toContain(BINARY)
    expect(reason).toMatch(/CAP_NET_ADMIN/)
    // And it must say the system's own installation is untouched — the reason the user is
    // asked to grant anything at all instead of us editing a distribution-owned file.
    expect(reason).toMatch(/left untouched/)
  })

  it('believes the daemon when it complains, even if capability looks fine', () => {
    // The capability check can read `true` from a file while the running process cannot use
    // it. The daemon's own message is the better witness, so it wins.
    const reason = diagnoseJoin(facts({ capable: true, complaint: `ERROR: ${TUN_FAILURE} for TAP operation` }))
    expect(reason).not.toBeNull()
  })

  it('ignores an unrelated complaint', () => {
    expect(diagnoseJoin(facts({ complaint: 'ERROR: something else entirely' }))).toBeNull()
  })
})
