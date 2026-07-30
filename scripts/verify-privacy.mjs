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
    pattern: /\b(?:holgi|holger\.kuehn)\b/gi,
    // The public funding slug and the deliberate maintainer contact are intentional.
    allow: [/^holgi18114$/i, /^holgi$/i],
    allowFiles: ['package.json', 'README.md', 'liesmich.md', 'LICENSE'],
  },
  {
    name: 'private domain',
    pattern: /@virtual-services\.info/g,
    // The maintainer contact is deliberately public in packaging metadata.
    allowFiles: ['package.json', 'resources/copyright'],
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
