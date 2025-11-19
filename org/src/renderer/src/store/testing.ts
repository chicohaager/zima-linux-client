// Used for testing phase only. etc, alpha, beta, etc.

import { Config } from '@renderer/utils/config'
import { defineStore } from 'pinia'

export const useTesting = defineStore('testing', () => {
  const testing = ref<ConfigSchema['testing']>({})
  function updateTesting() {
    Config
      .get('testing')
      .then((value) => {
        testing.value = value
      })
  }

  const ui = computed(() => testing.value.ui)
  function setUI(value: ConfigSchema['testing']['ui']) {
    Config
      .set('testing.ui', value)
      .then(() => {
        updateTesting()
      })
  }

  return {
    testing,
    updateTesting,
    ui,
    setUI,

  }
})
