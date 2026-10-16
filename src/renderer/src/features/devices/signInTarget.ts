import type { ConnectionKind } from '@shared/domain'

/** Where the sign-in form opens: address, path kind and what to store with it. */
export interface SignInTarget {
  readonly host: string
  readonly port: number
  readonly kind: ConnectionKind
  readonly displayName?: string
  /** The Remote ID, kept so it can be stored with the address and reopened later. */
  readonly networkId?: string
}
