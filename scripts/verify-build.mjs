#!/usr/bin/env node
/**
 * Guards the build artifacts against failures that are invisible in source.
 *
 * The reason this exists: the preload script was emitted as ESM (`index.mjs`) while the
 * renderer runs sandboxed. A sandboxed preload cannot use ESM, so the bridge silently
 * failed to load — `window.zima` was undefined and every action surfaced as a generic
 * "something went wrong", which read like a device problem. Type-check, lint, 63 unit
 * tests and the build were all green throughout.
 *
 * So the checks below inspect the emitted files, not the intent behind them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures = []
const notes = []

const check = (label, condition, detail) => {
  if (condition) notes.push(`  ok    ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else failures.push(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

// --- preload -----------------------------------------------------------------
const preloadDir = 'out/preload'
check('out/preload exists', existsSync(preloadDir))

if (existsSync(preloadDir)) {
  const files = readdirSync(preloadDir)
  const cjs = files.filter((f) => f.endsWith('.cjs'))
  const mjs = files.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'))

  check('preload is emitted as CommonJS', cjs.length > 0, `found ${files.join(', ')}`)
  check(
    'preload has no ESM artifact a sandboxed renderer cannot load',
    mjs.length === 0,
    mjs.length === 0 ? undefined : `unexpected ${mjs.join(', ')}`,
  )

  for (const file of cjs) {
    const content = readFileSync(join(preloadDir, file), 'utf8')
    check(
      `${file} has no top-level ESM syntax`,
      !/^\s*(?:import|export)\s/m.test(content),
      'a sandboxed preload must be pure CommonJS',
    )
    check(
      `${file} exposes the bridge`,
      content.includes('exposeInMainWorld'),
      'without this call window.zima stays undefined',
    )
    // The bridge is the most privileged boundary in the app; a validation library has no
    // business being bundled into it.
    check(`${file} does not bundle zod`, !content.includes('ZodError'), 'keep the bridge minimal')
  }
}

// --- main process ------------------------------------------------------------
const mainFile = 'out/main/index.js'
check('out/main/index.js exists', existsSync(mainFile))
if (existsSync(mainFile)) {
  const content = readFileSync(mainFile, 'utf8')
  // The path the main process actually hands to Electron must match what was emitted.
  check(
    'main references the .cjs preload',
    content.includes('preload/index.cjs'),
    'a stale .mjs path would silently disable the bridge',
  )
  check('renderer stays sandboxed', /sandbox:\s*!0|sandbox:\s*true/.test(content), 'sandbox must not be off')
  check(
    'context isolation stays on',
    /contextIsolation:\s*!0|contextIsolation:\s*true/.test(content),
    'without it the security model is gone',
  )
}

// --- renderer ---------------------------------------------------------------
const rendererIndex = 'out/renderer/index.html'
check('out/renderer/index.html exists', existsSync(rendererIndex))
if (existsSync(rendererIndex)) {
  const html = readFileSync(rendererIndex, 'utf8')
  // Read the policy VALUE, not the whole file: searching the file matched the word
  // inside this repository's own explanatory comment and reported a violation that did
  // not exist. Measure the thing being claimed, not something near it.
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)
  check('CSP meta tag is present', meta !== null)
  if (meta !== null) {
    const policy = meta[1]
    check("CSP forbids 'unsafe-eval'", !policy.includes('unsafe-eval'), policy.slice(0, 80))
    check("CSP pins default-src to 'self'", policy.includes("default-src 'self'"))
    check("CSP forbids objects", policy.includes("object-src 'none'"))
  }
}

const cssDir = 'out/renderer/assets'
if (existsSync(cssDir)) {
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css'))
  check('a stylesheet was emitted', css.length > 0)
  for (const file of css) {
    const content = readFileSync(join(cssDir, file), 'utf8')
    // An unclosed block makes a CSS parser swallow everything after it without an error,
    // so balance is checked here rather than trusted.
    let depth = 0
    for (const ch of content) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    check(`${file} has balanced braces`, depth === 0, `imbalance ${depth}`)
    check(`${file} keeps the dark variant`, content.includes("data-theme='dark']") || content.includes('data-theme="dark"]'))
  }
}

console.log(failures.length === 0 ? 'build gate: clean' : `build gate: ${failures.length} failure(s)`)
for (const line of [...failures, ...notes]) console.log(line)
process.exit(failures.length === 0 ? 0 : 1)
