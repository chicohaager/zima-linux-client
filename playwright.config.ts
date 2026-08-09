import { defineConfig } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * The suite drives the BUILT Electron app (`out/main/index.js`) against a replay of a real
 * device, so it can run in CI where no ZimaOS exists. What it is for is the layer every other
 * gate is blind to: raw i18n keys on screen, an empty list rendered as if it were data, an
 * error state that unit tests never see because they never render one.
 *
 * Deliberately NOT parallel: each test launches its own Electron process with its own user
 * data directory, and they all talk to one fake device on port 80. Two of them at once would
 * be measuring each other.
 */
export default defineConfig({
  testDir: './e2e/specs',
  // A cold Electron start plus a scripted walk through four screens is slow by nature.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // A test marked `.only` that reaches CI silently shrinks the suite to one case.
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] === undefined ? 'list' : [['list'], ['github']],
})
