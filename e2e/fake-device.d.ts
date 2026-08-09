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
  readonly stop: () => Promise<void>
}

export declare const startFakeDevice: () => Promise<FakeDevice>
