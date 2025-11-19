import presetZex from '@icewhale/preset-zex'
import { createExternalPackageIconLoader } from '@iconify/utils/lib/loader/external-pkg'
import { defineConfig, presetIcons, transformerDirectives, transformerVariantGroup } from 'unocss'
import { presetScrollbar } from 'unocss-preset-scrollbar'

export default defineConfig({
  presets: [
    presetZex({ presetIcons: false }),
    presetIcons({
      autoInstall: true,
      collections: {
        iw: createExternalPackageIconLoader(
          '@icewhale/icewhale-icons-json',
          true,
        )['icewhale-icons-json'],
        iwf: createExternalPackageIconLoader(
          '@icewhale/icewhale-file-icons',
          true,
        )['icewhale-file-icons'],
      },
    }),
    presetScrollbar(),
  ],
  shortcuts: {
    'app-drag': '[-webkit-app-region:drag] select-none',
    'app-no-drag': '[-webkit-app-region:no-drag] select-none',
    'mask-text': '[-webkit-mask:linear-gradient(#000_0_0)_text] [mask:linear-gradient(#000_0_0)_text]',
    'mask-border': '[-webkit-mask:linear-gradient(#000_0_0)_border] [mask:linear-gradient(#000_0_0)_border]',
  },
  transformers: [
    transformerVariantGroup(),
    transformerDirectives(),
  ],
  extendTheme: (theme) => {
    return {
      ...theme,
      fontFamily: {
        // @ts-expect-error - Add custom font
        ...theme.fontFamily,
        // @ts-expect-error - Add custom font
        sans: `"Britti Sans", ${theme.fontFamily.sans}`,
        // @ts-expect-error - Add custom font
        mono: `"Chivo Mono", ${theme.fontFamily.mono}`,
      },
    }
  },
  content: {
    filesystem: [
      './node_modules/zexui/dist/primevue/passthrough/**/*.{vue,js,ts,jsx,tsx}',
    ],
    pipeline: {
      include: [
        './src/index.html',
        './src/**/*.{vue,js,ts,jsx,tsx}',
        './src/renderer/index.html',
        './src/renderer/**/*.{vue,js,ts,jsx,tsx}',
        './node_modules/zexui/**/*.{vue,js,ts,jsx,tsx}',
      ],
    },
  },
})
