/**
 * Why a ZeroTier join was accepted and still did not take effect.
 *
 * Extracted from `daemon.ts` so it can be tested: this is the code that decides which of two
 * *different* causes the user is told about, and until now the only way to exercise it was to
 * break a real machine in the right way. The wrong choice here is expensive — it sends someone
 * to fix a file that is already correct — so it deserves a test more than most of the daemon
 * does.
 *
 * The inputs are facts gathered by the caller, not things this function goes and measures.
 * That is the point: the measuring is where the mistakes were (asking the file instead of the
 * process), and it stays visible in `daemon.ts` rather than hidden behind a call to here.
 */

export interface JoinFacts {
  /**
   * Does the RUNNING daemon hold CAP_NET_ADMIN? `null` means it could not be determined —
   * which is not the same as `false` and must not produce an accusation.
   */
  readonly capable: boolean | null
  /** The daemon's own last complaint, if it made one. */
  readonly complaint: string | null
  /** How the daemon was started; decides which of the two explanations applies. */
  readonly launchedVia: 'systemd-user' | 'child' | null
  /** Path of the binary the user would grant the capability to. */
  readonly managedBinary: string
}

/** The daemon's wording when it cannot create its virtual device. Measured 2026-07-30. */
export const TUN_FAILURE = 'unable to configure TUN/TAP device'

export const diagnoseJoin = (facts: JoinFacts): string | null => {
  const tunFailed = facts.complaint !== null && facts.complaint.includes(TUN_FAILURE)

  // `capable === null` means "not determined". Reporting a cause on that basis would be a
  // guess dressed as a diagnosis, so only a measured `false` — or the daemon saying so
  // itself — counts as evidence.
  if (facts.capable !== false && !tunFailed) return null

  /*
   * Two different causes, and they need different advice — conflating them is what sent the
   * last round of work at the wrong target.
   *
   * `launchedVia === 'child'` means the daemon inherited this app's `no_new_privs`, so the
   * kernel ignored the binary's file capabilities on exec. Setting them harder does not help;
   * the process tree is the problem. Saying "grant the capability" here would send someone to
   * fix a file that is already correct.
   */
  if (facts.launchedVia === 'child') {
    return (
      `the local ZeroTier daemon cannot create a virtual network device. It had to be ` +
      `started as a child of this application, which runs with no_new_privs, and the kernel ` +
      `ignores a binary's capabilities in that case. This client normally has systemd start ` +
      `the daemon outside its own process tree; that was not available here.`
    )
  }
  return (
    `the local ZeroTier daemon cannot create a virtual network device, so it accepts a ` +
    `join without ever entering the network. ${facts.managedBinary} needs CAP_NET_ADMIN — ` +
    `the system's zerotier-one is left untouched.`
  )
}
