import type { i18n as i18nType } from 'i18next'
import type { FsBackendOptions } from 'i18next-fs-backend'
import { app } from 'electron'
import log from 'electron-log/main'
import i18next from 'i18next'
import FsBackend from 'i18next-fs-backend'
import { Config } from './config'

export const i18n: i18nType = i18next.createInstance()
export async function initI18n(): Promise<void> {
  return new Promise<void>((resolve) => {
    const loadPath = `${app.getAppPath()}/resources/locales/{{lng}}.json`
    const addPath = `${app.getAppPath()}/resources/locales/{{lng}}.missing.json`

    const lngConfig = Config.get('language')
    const selectedLng = lngConfig === 'system' || !lngConfig
      ? app.getPreferredSystemLanguages()[0]
      : lngConfig

    log.info('Locales Config Language:', lngConfig)
    log.info('Locales Selected Language:', selectedLng)
    log.info('Locales loadPath:', loadPath)

    i18n
      .use(FsBackend)
      .init<FsBackendOptions>({
        initAsync: false,
        lng: selectedLng,
        // preload: ['en_US'],
        backend: {
          loadPath,
          addPath,
        },
        debug: import.meta.env.DEV,
        fallbackLng: (code) => {
          // "" => ["en_US"]
        // "en" => ["en_US"]
          if (!code || code === 'en')
            return ['en_US']
          // "zh" => ["zh_CN", "en_US"]
          if (code === 'zh')
            return ['zh_CN', 'en_US']

          // "zh_Hans_CN" => ["zh_Hans_CN", "zh_CN", "zh_Hans", "zh", "zh_CN", "en_US"]
          // "zh_Hant_TW" => ["zh_Hant_TW", "zh_TW", "zh_Hant", "zh", "zh_CN", "en_US"]
          // "en_CN" => ["en_CN", "en", "en_US"]
          // "en_AU" => ["en_AU", "en", "en_US"]
          // "es_419" => ["es_419", "es", "en_US"]
          const fallbacks = [code]
          const codeSplit = code.split(/[_-]/)
          if (codeSplit.length === 3) {
            fallbacks.push(`${codeSplit[0]}_${codeSplit[2]}`)
            fallbacks.push(`${codeSplit[0]}_${codeSplit[1]}`)
          }
          fallbacks.push(`${codeSplit[0]}`)
          if (code.startsWith('zh')) {
            fallbacks.push('zh_CN') // Last try for language starts with "zh"
          }
          fallbacks.push('en_US') // At least "en_US"
          return fallbacks
        },
      }, () => {
        resolve()
        log.info(`i18n Language: ${i18n.language}, localeCode: ${i18n.t('localeCode')}, languageName: ${i18n.t('languageName')}`)
      })
  })
}

i18n.on('languageChanged', (lng) => {
  log.info(`i18n Language Changed: ${lng}, localeCode: ${i18n.t('localeCode')}, languageName: ${i18n.t('languageName')}`)
})

export function $t(key: string, options?: any) {
  return i18n.t(
    key,
    {
      ...options,
      interpolation: {
        prefix: '{',
        suffix: '}',
      },
    },
  ) as string
}
