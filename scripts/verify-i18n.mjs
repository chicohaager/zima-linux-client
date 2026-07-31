#!/usr/bin/env node
/**
 * Translation coverage gate.
 *
 * Two failure modes it exists to prevent:
 *  - a locale that quietly lacks keys, so the interface falls back to English in places
 *    nobody looked at
 *  - a locale file that claims a language but is really a copy of English
 *
 * Coverage is REPORTED per locale rather than demanded to be 100%, because "translated" is
 * work in progress. What IS demanded: no unknown keys, no locale file missing entirely,
 * and no placeholder mismatch — a lost `{{count}}` renders as literal text to the user.
 */
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/renderer/src/i18n/locales'
const REFERENCE = 'en_US'

const flatten = (object, prefix = '') => {
  const out = new Map()
  for (const [key, value] of Object.entries(object)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, `${prefix}${key}.`)) out.set(k, v)
    } else {
      out.set(`${prefix}${key}`, String(value))
    }
  }
  return out
}

const placeholders = (text) => (text.match(/\{\{[a-zA-Z0-9_]+\}\}/g) ?? []).sort().join(',')

// The declared locale list is the contract; the files must match it exactly.
const localesTs = readFileSync('src/renderer/src/i18n/locales.ts', 'utf8')
const declared = [...localesTs.matchAll(/code:\s*'([a-z]{2}_[A-Z]{2})'/g)].map((m) => m[1])

const failures = []
const rows = []

if (!existsSync(join(DIR, `${REFERENCE}.json`))) {
  failures.push(`reference catalogue ${REFERENCE}.json is missing`)
}

const reference = flatten(JSON.parse(readFileSync(join(DIR, `${REFERENCE}.json`), 'utf8')))
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const present = new Set(files.map((f) => f.replace('.json', '')))

for (const locale of declared) {
  if (!present.has(locale)) {
    failures.push(`declared locale ${locale} has no catalogue file`)
  }
}
for (const locale of present) {
  if (!declared.includes(locale)) {
    failures.push(`catalogue ${locale}.json is not declared in locales.ts`)
  }
}

for (const locale of declared.filter((l) => present.has(l))) {
  const catalogue = flatten(JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8')))

  const unknown = [...catalogue.keys()].filter((k) => !reference.has(k))
  for (const key of unknown) failures.push(`${locale}: key "${key}" does not exist in ${REFERENCE}`)

  let translated = 0
  let identical = 0
  for (const [key, englishText] of reference) {
    const text = catalogue.get(key)
    if (text === undefined) continue
    translated++
    if (text === englishText) identical++

    // A dropped placeholder is not a style question: the user sees "{{count}}" or, worse,
    // a sentence that silently loses its number.
    if (placeholders(text) !== placeholders(englishText)) {
      failures.push(
        `${locale}: placeholders differ for "${key}" (${placeholders(englishText)} vs ${placeholders(text)})`,
      )
    }
  }

  const coverage = Math.round((translated / reference.size) * 100)
  // For a non-English locale, "identical to English everywhere" means the file is a copy.
  const suspiciouslyEnglish =
    !locale.startsWith('en_') && translated > 0 && identical / translated > 0.9
  if (suspiciouslyEnglish) {
    failures.push(`${locale}: ${Math.round((identical / translated) * 100)}% identical to English — is this really translated?`)
  }

  rows.push(
    `  ${locale}  ${String(coverage).padStart(3)}%  ${String(translated).padStart(3)}/${reference.size} keys` +
      (locale.startsWith('en_') ? '' : `  ${Math.round((identical / Math.max(1, translated)) * 100)}% identical to en`),
  )
}

/*
 * The other direction: does the catalogue cover the CODE?
 *
 * Everything above compares locales with each other. All 28 can agree perfectly and a screen
 * still show `files.newFolderPrompt` as raw text, because the key the code asks for was never
 * in `en_US` either — the gate would report "clean" for a catalogue that is complete and
 * wrong. That is the same failure `dynamicKeys.test.ts` was written for after
 * `device.connection.tailscale` reached a user's screen; this covers the static half, which
 * no test looks at.
 *
 * Deliberately restricted to LITERAL keys — `t('a.b')` and the i18n key argument of
 * `appError`. A first attempt matched every dotted string in the source and produced 21
 * "findings", all of them log event names (`zerotier.joined`, `backup.started`): it measured
 * the SHAPE of a string instead of its USE, which is how a check ends up with a false-positive
 * rate that makes people ignore it. Composed keys stay the business of dynamicKeys.test.ts,
 * which enumerates them from the contract.
 */
const sourceFiles = execSync('git ls-files src', { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('__tests__'))

let literalKeys = 0
for (const file of sourceFiles) {
  const source = readFileSync(file, 'utf8')
  const referenced = [
    ...[...source.matchAll(/\bt\(\s*'([^'`]+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/'(error\.[A-Za-z0-9_.-]+)'/g)].map((m) => m[1]),
  ]
  for (const key of referenced) {
    literalKeys += 1
    if (!reference.has(key)) {
      failures.push(`${file}: uses i18n key "${key}", which ${REFERENCE} does not define`)
    }
  }
}

// The headline must not be greener than the rows underneath it. It used to read
// "28 locales, 253 keys each" — true of two files on the day the other 26 sat at 111 keys,
// because coverage is reported rather than demanded. Reporting is the right call for
// translation work in progress; claiming completeness while reporting it is not.
const complete = rows.filter((row) => row.includes('100%')).length
console.log(
  failures.length === 0
    ? `i18n gate: clean — ${declared.length} locales, ${reference.size} keys in ${REFERENCE}, ${literalKeys} literal uses in code; ` +
        `${complete} locale(s) at 100%, ${declared.length - complete} partial (see below)`
    : `i18n gate: ${failures.length} failure(s)`,
)
for (const line of failures) console.log(`  FAIL  ${line}`)
for (const line of rows) console.log(line)
process.exit(failures.length === 0 ? 0 : 1)
