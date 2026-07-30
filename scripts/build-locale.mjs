#!/usr/bin/env node
/**
 * Turns a flat {locale: {"dotted.key": "text"}} batch file into nested catalogues.
 *
 * It refuses to write a partial catalogue: a locale that is missing keys, or carries keys
 * that do not exist in the reference, fails loudly. A half-written catalogue would fall
 * back to English in places nobody looked at — the exact failure the i18n gate is meant to
 * make impossible.
 *
 * Usage: node scripts/build-locale.mjs <batch.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/renderer/src/i18n/locales'
const REFERENCE = 'en_US'

const flatten = (object, prefix = '') => {
  const out = new Map()
  for (const [key, value] of Object.entries(object)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value, `${prefix}${key}.`)) out.set(k, v)
    } else out.set(`${prefix}${key}`, String(value))
  }
  return out
}

const unflatten = (flat) => {
  const root = {}
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.')
    let node = root
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {}
      node = node[part]
    }
    node[parts.at(-1)] = value
  }
  return root
}

const batchPath = process.argv[2]
if (batchPath === undefined) {
  console.error('usage: node scripts/build-locale.mjs <batch.json>')
  process.exit(2)
}

const reference = flatten(JSON.parse(readFileSync(join(DIR, `${REFERENCE}.json`), 'utf8')))
const batch = JSON.parse(readFileSync(batchPath, 'utf8'))
const problems = []

for (const [locale, flat] of Object.entries(batch)) {
  const missing = [...reference.keys()].filter((k) => !(k in flat))
  const unknown = Object.keys(flat).filter((k) => !reference.has(k))
  if (missing.length > 0) problems.push(`${locale}: ${missing.length} missing key(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' …' : ''}`)
  if (unknown.length > 0) problems.push(`${locale}: unknown key(s): ${unknown.join(', ')}`)
}

if (problems.length > 0) {
  console.error('refusing to write — the batch is incomplete:')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

for (const [locale, flat] of Object.entries(batch)) {
  // Keys are written in the reference order so catalogues stay diffable against each other.
  const ordered = {}
  for (const key of reference.keys()) ordered[key] = flat[key]
  writeFileSync(join(DIR, `${locale}.json`), `${JSON.stringify(unflatten(ordered), null, 2)}\n`, 'utf8')
  console.log(`wrote ${locale}.json (${reference.size} keys)`)
}
