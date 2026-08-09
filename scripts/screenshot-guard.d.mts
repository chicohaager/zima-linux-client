/** Types for `screenshot-guard.mjs`. Plain `.mjs` there because it is Node-side tooling. */

export declare const ALLOWED_ADDRESS: string

export interface PrivateFindings {
  /** Addresses reduced to their first octet — never the value itself. */
  readonly masked: readonly string[]
  readonly count: number
  readonly labels: readonly string[]
  /** Home paths reduced to `/home/<user>` — never the name. */
  readonly homes: readonly string[]
}

export declare const findPrivate: (text: string) => PrivateFindings
export declare const isClean: (found: PrivateFindings) => boolean
