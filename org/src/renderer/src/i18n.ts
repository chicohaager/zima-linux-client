import messages from '@intlify/unplugin-vue-i18n/messages'
import { createI18n } from 'vue-i18n'

const i18n = createI18n({
  legacy: false, // for composition API
  locale: 'en_US',
  fallbackLocale: 'en_US',
  messages,
})

export default i18n
