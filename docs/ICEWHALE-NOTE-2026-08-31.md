# Two undocumented API changes in ZimaOS v1.7.1-beta1 that break third-party clients

Measured 2026-08-31 on a ZimaCube running **ZimaOS v1.7.1-beta1** (amd64), while porting a
third-party Linux desktop client that worked against v1.7.0. Both changes look deliberate and
reasonable — this is not a bug report, it is a request to confirm them so clients can adapt
rather than guess. Addresses below are redacted; the four rows are one and the same device
asked over its four own interfaces.

## 1. `GET /v1/gateway/routes` now requires a token — except from `127.0.0.1`

Under v1.7.0 this endpoint answered HTTP 200 without credentials, which made it the natural
way for a client to learn a device's capabilities. Under v1.7.1-beta1:

| asked from | `/v1/gateway/routes` | `/v1/users/status` |
| --- | --- | --- |
| `127.0.0.1` | **200** | 200 |
| its own LAN address | **401** | 200 |
| its ZeroTier address | **401** | 200 |
| its Tailscale address | **401** | 200 |

With a valid access token: **200, 2195 bytes**. With `Authorization: Bearer <invalid>`: **401**.
So it is an authentication requirement, not a filter on the source address. All three header
spellings are accepted on this endpoint (`<jwt>`, `Bearer <jwt>`, `bearer <jwt>`); only a
missing header is refused.

**Why it hurts a client more than it looks.** A reachability probe runs *before* the login, so
it has no token by construction. A client that probed this endpoint now reports every healthy
device as unreachable — including over a tunnel that demonstrably answered in 282 ms. Since
one probe usually feeds every connection route, all of them fail at once.

**Question:** is there an endpoint you intend clients to use for "is a ZimaOS gateway
listening here?" before authentication? We settled on `GET /v1/users/status` because it is the
only one we found that answers 200 without a token from every interface, and because its body
(`{"success":200,…,"initialized":true,…}`) is the "has this device been set up yet" question a
pre-login screen needs. We could not confirm from the shipped bundle whether your own web UI
uses it — the paths are assembled at runtime, so a literal search finds neither this one nor
`/v1/users/login`. If a different endpoint is the intended one, we would rather use that.

## 2. The access token's `iss` changed from `casaos` to `zimaos`

Decoded from a fresh login on the same device (claims only, no token values):

```
access_token    iss = "zimaos"     role = admin    exp - iat = 10800 s
refresh_token   iss = "refresh"    role = admin    exp - iat = 604800 s
claim set both: exp, iat, id, iss, nbf, role, username   (unchanged from v1.7.0)
```

Exactly one of the two moved — the refresh issuer is still `refresh`.

**Why this is sharper than a rename.** Access and refresh tokens are signed with the **same
key**, so `iss` is the only thing distinguishing them. A careful client therefore *pins* the
issuer, precisely so a long-lived refresh token can never be spent as a session credential.
That correct precaution turns a rename into a hard stop: every sign-in fails with
`unknown token issuer "zimaos"`, while the connection itself is perfectly healthy.

**Question:** is `zimaos` the final name for the access issuer, and is `refresh` staying as it
is? We now accept both `casaos` and `zimaos` so that devices on either firmware keep working,
but we would rather follow a documented value than a measured one.

## What would help

Both changes are invisible until a client breaks in the field, and neither appears in the
release notes we could find. A short note in the changelog for API-surface changes —
authentication requirements and token claims in particular — would let integrators adapt
before their users notice.

Happy to supply the exact requests and responses for any of the above.
