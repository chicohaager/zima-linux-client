<script setup lang="ts">
import { NButton } from 'naive-ui'

const ipcRenderer = window.electron.ipcRenderer
const platform = window.platform

function done() {
  ipcRenderer.invoke('window:close', true)
  ipcRenderer.invoke('mainWindow:show')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    done()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <WindowControl :title="$t('login')" hide-title />
  <div
    class="absolute left-0 top-0 h-vh w-vw flex flex-col justify-between justify-between gap-4 bg-surface-0 bg-cover p-10 dark:bg-surface-950"
  >
    <div class="flex flex-col gap-3">
      <span class="text-4xl text-surface-900 dark:text-surface-50">
        {{ $t('loginSuccess') }}
      </span>
      <span class="text-sm text-surface-500">
        {{
          platform === 'darwin'
            ? $t('loginSuccessTip.mac')
            : platform === 'win32'
              ? $t('loginSuccessTip.windows')
              : ''
        }}
      </span>
    </div>

    <form
      class="flex items-end justify-between"
      @submit.prevent="() => {
        ipcRenderer.invoke('window:close', true)
        ipcRenderer.invoke('mainWindow:show')
      }"
    >
      <div class="w-60 flex flex-col items-start gap-4" />
      <div class="size-fit flex items-center">
        <NButton
          v-focus
          circle
          size="large"
          class="h-fit w-fit p-5"
          type="primary"
          attr-type="submit"
        >
          <template #icon>
            <i class="i-iw:check size-6" />
          </template>
        </NButton>
      </div>
    </form>
  </div>
</template>
