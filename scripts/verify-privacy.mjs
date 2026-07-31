#!/usr/bin/env node
/**
 * Privacy gate.
 *
 * This repository is public, so it must not carry private network details. The
 * patterns live here, in the script, and not in prose next to it — a document that
 * quotes its own search terms defeats the check it is describing.
 *
 * Runs over tracked files only, and skips the legacy tree plus this file itself.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SELF = 'scripts/verify-privacy.mjs'

/** Each rule: what it looks for, and which known-harmless forms are allowed. */
const RULES = [
  {
    name: 'RFC1918 address',
    pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    // Documentation examples and the ZeroTier range are fine; a real home address is not.
    allow: [/^192\.168\.1\.100$/, /^192\.168\.1\.1$/, /^192\.168\.0\.\d+$/, /^10\.147\.\d+\.\d+$/, /^192\.168\.50\.50$/, /^10\.0\.0\.1$/, /^192\.168\.1\.256$/],
  },
  {
    name: 'maintainer identity',
    /*
     * The trailing \b used to sit right after the name, so the rule matched "Holgi" and
     * missed "Holgis" — German puts the genitive -s straight onto the name, and that is how
     * it actually occurs in these documents. Measured 2026-07-31: the gate reported clean
     * while "Holgis Wunsch" stood in a tracked doc. A name check has to survive inflection,
     * so the word may continue after the name.
     */
    pattern: /\b(?:holgi\w*|holger[._-]?kuehn)\b/gi,
    /**
     * NO value-level allowance here, on purpose.
     *
     * This list used to contain /^holgi$/i — an exception exactly as wide as the pattern,
     * which silently disabled the whole rule: the gate reported "clean" while the name sat
     * in a tracked doc, and it could never have reported anything else. An allowance must
     * be narrower than the thing it excuses, otherwise it is a deletion wearing a
     * whitelist's clothes. Where the maintainer name is deliberate (funding slug, package
     * author, licence) the exemption belongs in allowFiles, which is scoped to a path.
     */
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
  console.log(`privacy gate: clean (${trackedFiles().length} tracked files checked)`)
  process.exit(0)
}

console.error(`privacy gate: ${findings.length} finding(s)`)
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.rule}: ${f.value}`)
}
process.exit(1)
