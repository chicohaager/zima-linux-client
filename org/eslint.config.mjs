// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    // Configures for antfu's config
    typescript: true,
    vue: true,
    unocss: true,
    markdown: true,
    formatters: {
      css: true,
      html: true,
    }
  },
  {
    // Configures for eslint
    name: 'zima-client-v2-eslint',
    rules: {
      'no-console': 'warn',
      // 'ts/no-unused-expressions': 'off',
    },
  },
)
