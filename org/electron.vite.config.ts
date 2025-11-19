import { resolve } from 'node:path'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import vue from '@vitejs/plugin-vue'
import { bytecodePlugin, defineConfig, externalizeDepsPlugin } from 'electron-vite'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import IconsResolver from 'unplugin-icons/resolver'
import Icons from 'unplugin-icons/vite'
import TurboConsole from 'unplugin-turbo-console/vite'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      bytecodePlugin({
        transformArrowFunctions: false,
      }),
    ],
    build: {
      rollupOptions: {
        external: [
          /^@icewhale\//,
        ],
      },
    },
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@utils': resolve('src/main/utils'),
        '@resources': resolve('resources'),
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin(),
    ],
    resolve: {
      alias: {
        '@main': resolve('src/main/src'),
        '@preload': resolve('src/preload/src'),
        '@resources': resolve('resources'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@resources': resolve('src/renderer/resources'),
      },
    },
    plugins: [
      vue(),
      UnoCSS(),
      VueI18nPlugin({
        include: ['resources/locales/**'],
      }),
      Components({
        dts: 'src/types/components.d.ts',
        resolvers: [IconsResolver({})],
      }),
      AutoImport({
        dts: 'src/types/auto-imports.d.ts',
        imports: ['vue'],
      }),
      Icons({
        autoInstall: true,
        compiler: 'vue3',
      }),
      TurboConsole(),
    ],
  },
})
