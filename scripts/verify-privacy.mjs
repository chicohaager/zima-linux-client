#!/usr/bin/env node
/**
 * Privacy gate.
 *
 * This repository is public, so it must not carry private network details. The
 * patterns live here, in the script, and not in prose next to it — a document that
 * quotes its own search terms defeats the check it is describing.
 *
 * Runs over tracked files only, and skips the legacy tree plus this file itself.
 *
 * The maintainer-identity rule is the one exception to "patterns live here": its search
 * terms ARE the private data, so a tracked script that spelled them out would be the leak it
 * guards against (found 2026-09-17 by the machine-wide scanner, which blocked the push). The
 * terms come from outside the repository — `scripts/privacy-identity.local` (git-ignored,
 * one regex source per line, `#` comments) or the environment variable
 * `ZIMA_PRIVACY_IDENTITY` (regex sources separated by `|||`). If neither is present the gate
 * says so and FAILS, because a rule that silently checks nothing is worse than none; set
 * `ZIMA_PRIVACY_IDENTITY=none` to opt out explicitly (a fork's CI, for example), which is
 * printed as a warning and never as "clean".
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const SELF = 'scripts/verify-privacy.mjs'
const IDENTITY_FILE = 'scripts/privacy-identity.local'

/** Regex sources for the identity rule, from the environment or the local file — never from here. */
const identitySources = () => {
  const fromEnv = process.env['ZIMA_PRIVACY_IDENTITY']
  if (fromEnv === 'none') return { sources: [], origin: 'opted out via ZIMA_PRIVACY_IDENTITY=none' }
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return { sources: fromEnv.split('|||').map((s) => s.trim()).filter((s) => s.length > 0), origin: 'environment' }
  }
  if (existsSync(IDENTITY_FILE)) {
    const sources = readFileSync(IDENTITY_FILE, 'utf8')
      .split('\n')
      .map((line) => line.replace(/\s+#.*$/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
    return { sources, origin: IDENTITY_FILE }
  }
  return null
}

const identity = identitySources()
if (identity === null) {
  console.error(
    `privacy gate: the maintainer-identity rule is NOT configured — create ${IDENTITY_FILE} ` +
      '(one regex source per line) or set ZIMA_PRIVACY_IDENTITY; ZIMA_PRIVACY_IDENTITY=none opts out explicitly.',
  )
  process.exit(1)
}
if (identity.sources.length === 0) {
  console.warn('privacy gate: WARNING — maintainer-identity rule skipped (' + identity.origin + ')')
}

/** Each rule: what it looks for, and which known-harmless forms are allowed. */
const RULES = [
  {
    name: 'RFC1918 address',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    // Documentation examples and the ZeroTier range are fine; a real home address is not.
    // 2026-09-17: the placeholder examples moved from 192.168.1.x to 192.168.0.x — the
    // former is the maintainer's own LAN range, and an example address inside one's own
    // network is a leak wearing a placeholder's clothes. The two dead allowances went with it.
    // The last one is the single 172.16/12 representative used by the fixture scrubber's
    // canary — an exact value, not the range, so the rule keeps its teeth everywhere else.
    allow: [/^192\.168\.0\.\d+$/, /^10\.147\.\d+\.\d+$/, /^192\.168\.50\.50$/, /^10\.0\.0\.1$/, /^192\.168\.1\.256$/, /^172\.20\.1\.9$/],
    /*
     * One file, by path, because its SUBJECT is these addresses: `urlPolicy.test.ts` asserts
     * that RFC1918 targets are refused, and it cannot do that without naming one of each
     * range. Scoped to the path rather than widened by value — a value-level allowance for
     * `10.*` would switch the rule off everywhere, which is how this gate was already broken
     * once (a value-level allowance in the identity rule, exactly as wide as its pattern).
     * The literals in there are canonical range representatives, not addresses from anyone's
     * network.
     */
    allowFiles: ['src/main/media/__tests__/urlPolicy.test.ts'],
  },
  {
    /*
     * A device's own UUID from `/v2/zimaos/device/info`. Found on 2026-08-10 in the tracked
     * E2E fixture: the recording had been scrubbed of addresses, mail and tokens, and the
     * device code sat there untouched because none of those rules describe a UUID. It names
     * one physical machine.
     *
     * Written as a POSITIVE property, not as a list of forbidden values: a blocklist would
     * have to contain the real code to work, which is the very thing that must not be
     * committed. So any UUID is a finding unless it is the documentation stand-in the
     * scrubber writes.
     */
    name: 'device code (UUID)',
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    allow: [/^0f3b7c9e-1a2d-4b5c-8e6f-7a8b9c0d1e2f$/i, /^9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d$/i],
    allowFiles: [],
  },
  {
    name: 'maintainer identity',
    /*
     * The pattern is assembled from outside the repository (see the header). Two lessons
     * are baked into how the sources are written there, and belong here so they survive:
     * the name must be allowed to CONTINUE after the match — German puts the genitive -s
     * straight onto a name, and the gate once reported clean while the inflected form stood
     * in a tracked doc (2026-07-31); and there is NO value-level allowance, on purpose: the
     * list once held an exception exactly as wide as the pattern, which disabled the rule
     * while it reported "clean". Where the name is deliberate (funding slug, package author,
     * licence) the exemption is a path in allowFiles, never a value.
     */
    pattern: new RegExp(identity.sources.length === 0 ? '(?!)' : `\\b(?:${identity.sources.join('|')})\\b`, 'gi'),
    allowFiles: ['package.json', 'README.md', 'liesmich.md', 'LICENSE'],
  },
  {
    name: 'private domain',
    /**
     * The bare domain, not only the e-mail form.
     *
     * This pattern was `/@virtual-services\.info/` — anchored on the `@`. On 2026-07-30 the
     * tailnet NAME (the same domain without an address in front of it) went into a tracked
     * document and the gate reported "clean", because the one character it insisted on was
     * not there. A rule that only recognises private data in one syntactic dress does not
     * cover the data, it covers the dress.
     */
    pattern: /\bvirtual-services\.info\b/g,
    // The maintainer contact is deliberately public in packaging metadata.
    allowFiles: ['package.json', 'resources/copyright'],
  },
  {
    name: 'tailscale CGNAT address',
    /**
     * 100.64.0.0/10 — a real tailnet's addressing is network topology, the same class of
     * data as a LAN address, and it identifies the machines of one person's tailnet.
     */
    pattern: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    /**
     * Narrower than the rule by four million addresses: only the sequential stand-ins the
     * test fixture uses. Enumerated rather than expressed as a range, so extending it is a
     * visible edit and not a widening that goes unnoticed.
     */
    allow: [/^100\.64\.0\.[1-9]$/],
  },
]

const trackedFiles = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.length > 0)
    .filter((f) => !f.startsWith('legacy-0.9/') && f !== SELF)
    .filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|so|node)$/i.test(f))
    .filter((f) => !f.startsWith('bin/'))

const findings = []

for (const file of trackedFiles()) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue // binary or unreadable — nothing textual to leak
  }
  for (const rule of RULES) {
    if (rule.allowFiles?.includes(file)) continue
    for (const match of content.matchAll(rule.pattern)) {
      const value = match[0]
      if (rule.allow?.some((a) => a.test(value))) continue
      const line = content.slice(0, match.index).split('\n').length
      findings.push({ file, line, rule: rule.name, value })
    }
  }
}

if (findings.length === 0) {
  // A skipped identity rule is said on the clean line too, so a log excerpt cannot read as
  // "everything checked" when one rule checked nothing.
  const skipped = identity.sources.length === 0 ? ' — maintainer-identity rule SKIPPED' : ''
  console.log(`privacy gate: clean (${trackedFiles().length} tracked files checked)${skipped}`)
  process.exit(0)
}

console.error(`privacy gate: ${findings.length} finding(s)`)
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.rule}: ${f.value}`)
}
process.exit(1)
