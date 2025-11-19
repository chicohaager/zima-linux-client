<script setup lang="ts">
import { Config } from '@renderer/utils/config'
import Initializing from './Initializing.vue'
import Welcome from './Welcome.vue'

const ipcRenderer = window.electron.ipcRenderer

const mounted = ref(false)
const initialized = ref(false)
const wasInitialized = ref(false)

onMounted(() => {
  Config.get('initialized').then((value) => {
    wasInitialized.value = value
    mounted.value = true

    const unwatchInitialized = watch(
      () => initialized.value,
      (value) => {
        if (value) {
          unwatchInitialized()

          if (!wasInitialized.value) {
            Config.set('initialized', true)
          }
          else {
            setTimeout(() => {
              ipcRenderer.invoke('app:main')
              ipcRenderer.invoke('window:close', true)
            }, 700)
          }
        }
      },
    )
  })
})
</script>

<template>
  <div class="relative h-vh w-vw">
    <WindowControl :title="initialized ? $t('welcome') : $t('initialization')" hide-title />
    <Transition
      enter-from-class="opacity-0"
      enter-active-class="transition-opacity duration-700"
      enter-to-class="opacity-100"
      leave-from-class="opacity-100"
      leave-active-class="transition-opacity duration-700"
      leave-to-class="opacity-0"
    >
      <!-- Initializing -->
      <Initializing v-if="mounted && !initialized" v-model:initialized="initialized" :was-initialized="wasInitialized" />
    </Transition>
    <Transition
      enter-from-class="opacity-0"
      enter-active-class="transition-opacity duration-700"
      enter-to-class="opacity-100"
    >
      <!-- Welcome -->
      <Welcome v-if="initialized && !wasInitialized" />
    </Transition>
  </div>
</template>
