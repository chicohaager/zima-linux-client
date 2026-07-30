import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    globals: true,
    // Node by default. Renderer tests opt in per file with the docblock
    // `// @vitest-environment jsdom` — explicit beats a glob that silently
    // stops matching when a folder is renamed.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
