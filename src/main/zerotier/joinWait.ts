/**
 * How long a join is waited for — kept apart from `daemon.ts` so the loop itself is tested,
 * not a copy of it.
 *
 * Two different waits, with two different budgets:
 *
 *  1. **Listing.** The membership appears in `/network` a moment after the POST returns.
 *     Not listed after a few seconds means the daemon cannot enter the network at all (no
 *     capability — `diagnosis.ts` says which), and waiting longer does not help.
 *  2. **Configuration.** Listed but `REQUESTING_CONFIGURATION` means the controller has not
 *     answered yet. Measured 2026-10-28 on ZimaOS 1.8.0: 5.2 s for a fresh identity. Before
 *     this wait existed the client stopped after the listing alone, and the first Remote-ID
 *     connect of every new installation failed with "announces no route".
 *
 * Any other state is a decision (OK, ACCESS_DENIED, NOT_FOUND …) and ends the wait at once.
 */

export interface JoinSnapshot {
  readonly networks: ReadonlyArray<{ readonly networkId: string; readonly status: string }>
}

export interface JoinWaitOptions {
  readonly listMs: number
  readonly configMs: number
  readonly stepMs: number
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const AWAITING = 'REQUESTING_CONFIGURATION'

export const JOIN_WAIT: Omit<JoinWaitOptions, 'now' | 'sleep'> = {
  listMs: 3_000,
  // Six times the measured 5.2 s: a slow controller or a relayed path should still land,
  // and a dead one still ends with a message instead of a spinner.
  configMs: 30_000,
  stepMs: 250,
}

export const REAL_CLOCK: Pick<JoinWaitOptions, 'now' | 'sleep'> = {
  now: Date.now,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

export const waitForJoin = async <T extends JoinSnapshot>(
  networkId: string,
  read: () => Promise<T>,
  options: JoinWaitOptions,
): Promise<T> => {
  const started = options.now()
  let snapshot = await read()
  for (;;) {
    const network = snapshot.networks.find((entry) => entry.networkId === networkId)
    const elapsed = options.now() - started
    if (network === undefined) {
      if (elapsed >= options.listMs) return snapshot
    } else if (network.status !== AWAITING || elapsed >= options.configMs) {
      return snapshot
    }
    await options.sleep(options.stepMs)
    snapshot = await read()
  }
}
