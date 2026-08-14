/** Types for `fake-device.mjs`. See there for why the implementation is not TypeScript. */

export declare const FAKE_HOST: string

export declare const credentials: {
  readonly username: string
  readonly password: string
}

export interface FakeDevice {
  /** How port 80 was obtained — recorded so a CI log says which path ran. */
  readonly mode: 'direct' | 'docker'
  /** Every request the fake actually served, in order. */
  readonly served: () => Promise<readonly string[]>
  /**
   * Makes the replay claim it has no such gateway routes — `[]` restores the recording.
   * Throws if the fake did not take it, or if the recorded table never had them.
   */
  readonly without: (prefixes: readonly string[]) => Promise<void>
  readonly stop: () => Promise<void>
}

export declare const startFakeDevice: () => Promise<FakeDevice>
