<script setup lang="ts">
import welcomeBgUrl from '@renderer/assets/images/welcomeBg.png?url'
import { NButton } from 'naive-ui'

const ipcRenderer = window.electron.ipcRenderer
</script>

<template>
  <div
    class="app-drag absolute left-0 top-0 h-vh w-vw flex flex-col justify-between bg-cover p-10"
    :style="`background-image: url(${welcomeBgUrl});`"
  >
    <span class="text-7xl text-surface-50">{{ $t('welcomeToZima') }}</span>
    <div class="h-fit flex items-center justify-end">
      <NButton
        primary circle class="h-fit w-fit p-5 bg-surface-0! active:bg-surface-200! hover:bg-surface-100!" size="large" style="-webkit-app-region: no-drag;"
        @click="() => {
          ipcRenderer.invoke('window:close', true)
          ipcRenderer.invoke('app:main')
        }"
      >
        <i class="i-iw:right-forward size-6 text-primary-500" />
      </NButton>
    </div>
  </div>
</template>
