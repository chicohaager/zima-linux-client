import { describe, expect, it } from 'vitest'
import { connectionKindSchema, probeResultSchema } from '@shared/contractCore'
import en from '../locales/en_US.json'
import de from '../locales/de_DE.json'

/**
 * Every interface string built as `t(\`prefix.${value}\`)` must exist for every value the
 * type allows.
 *
 * 🔴 Written because `device.connection.tailscale` reached a user's screen as raw text on
 * 2026-07-30. Adding `tailscale` to `ConnectionKind` made a fourth value possible; the
 * catalogue still had three. Type-check, lint, 115 tests, the build gate, the i18n gate and
 * a full tour run were all green — a dynamic key is invisible to every one of them.
 *
 * The i18n gate cannot catch this either: it compares locales against `en_US`, and this key
 * was missing from `en_US` too. It measures whether the catalogues agree, not whether they
 * cover the code.
 *
 * **The values come from the contract, not from a list written here.** A hand-copied list
 * would pass forever after the next enum gains a member — the exact failure being guarded
 * against, one level up.
 */

const flat = (object: unknown, prefix = ''): Map<string, string> => {
  const out = new Map<string, string>()
  if (typeof object !== 'object' || object === null) return out
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'object' && value !== null) {
      for (const [k, v] of flat(value, `${prefix}${key}.`)) out.set(k, v)
    } else {
      out.set(`${prefix}${key}`, String(value))
    }
  }
  return out
}

const CATALOGUES = [
  ['en_US', flat(en)],
  ['de_DE', flat(de)],
] as const

/** Prefix plus the values the code can actually substitute, read off the schemas. */
const DYNAMIC = [
  {
    // SessionCard.tsx, DeviceList.tsx
    prefix: 'device.connection',
    values: connectionKindSchema.options,
  },
  {
    // DiscoveryResults.tsx — note these are kebab-case, while the AppError i18n keys next
    // to them are camelCase. `error.unexpected-status` was missing for the same reason.
    prefix: 'error',
    values: probeResultSchema.shape.failure.unwrap().options,
  },
] as const

describe('dynamically built translation keys', () => {
  for (const [locale, catalogue] of CATALOGUES) {
    for (const { prefix, values } of DYNAMIC) {
      it.each([...values])(`${locale} defines ${prefix}.%s`, (value) => {
        expect(catalogue.get(`${prefix}.${value}`)).toBeTypeOf('string')
      })
    }
  }

  /**
   * Positive control: the guard must be able to fail. If the enums were ever read as an
   * empty list, every `it.each` above would silently generate zero test cases and this
   * suite would pass while checking nothing.
   */
  it('actually has values to check', () => {
    for (const { values } of DYNAMIC) expect(values.length).toBeGreaterThan(0)
    expect(connectionKindSchema.options).toContain('tailscale')
  })
})
