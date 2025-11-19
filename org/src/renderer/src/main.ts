import type { ZexPrimeVueConfiguration } from 'zexui/primevue'

import { devtools } from '@vue/devtools'
import { createPinia } from 'pinia'
import FocusTrap from 'primevue/focustrap'
import Tooltip from 'primevue/tooltip'
import { createApp } from 'vue'

import ZexPrimeVue from 'zexui/primevue'
import App from './App.vue'
import i18n from './i18n'

import router from './router'
import '@unocss/reset/tailwind-compat.css'
import 'virtual:uno.css'
import 'uno.css'
import './assets/main.css'

if (import.meta.env.DEV) {
  devtools.connect('localhost', 8098)
}

const ipcRenderer = window.ipcRenderer
ipcRenderer.invoke('$t', 'localeCode')
  .then((localeCode) => {
    i18n.global.locale.value = localeCode
  })

const pinia = createPinia()

const app = createApp(App)

app.use(i18n)
app.use(router)
app.use(pinia)

app.use(ZexPrimeVue, {} as ZexPrimeVueConfiguration)
app.directive('tooltip', Tooltip)
app.directive('focustrap', FocusTrap)

app.directive('focus', {
  mounted(el) {
    // focus on the element's first focusable child
    const focusable = el.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    if (focusable) {
      focusable.focus()
    }
  },
})

app.mount('#app')
