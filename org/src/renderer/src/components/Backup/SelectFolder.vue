<script setup lang="ts">
import type { OpenDialogOptions } from 'electron'
import { NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  selectOnMounted?: boolean
  disabled?: boolean
}>()

const ipcRenderer = window.electron.ipcRenderer

const folder = defineModel<string | null>('folder', {
  default: null,
})

const folderName = computed(() => {
  if (folder.value) {
    // if mac root path, return "Root"
    if (folder.value === '/') {
      return 'Root'
    }
    // if windows disk root path, like "C:\" return "C"
    else if (folder.value.match(/^[A-Z]:[\\/]$/)) {
      return folder.value.split(':').shift()
    }
    else {
      return folder.value.split(/[\\/]/).pop()
    }
  }
  return ''
})

const { t } = useI18n()

function selectFolder() {
  ipcRenderer.invoke(
    'dialog:openDirectory',
    {
      title: t('selectFolder'),
    } as OpenDialogOptions,
  ).then((res) => {
    if (!res.canceled) {
      folder.value = res.filePaths[0]
    }
  })
}

onMounted(() => {
  if (props.selectOnMounted) {
    selectFolder()
  }
})
</script>

<template>
  <div
    v-if="folder"
    class="size-full flex items-center justify-between gap-4 border border-surface-300 rounded-xl bg-white p-4 dark:border-surface-700 dark:bg-black"
  >
    <div class="flex flex-row items-center gap-4">
      <i class="i-iwf:default-folder size-12" />
      <div class="h-12 flex flex-col justify-between">
        <span class="line-clamp-1 text-base" :title="folderName">
          {{ folderName }}
        </span>
        <LeoTag>
          <span class="line-clamp-1" :title="folder">
            {{ folder }}
          </span>
        </LeoTag>
      </div>
    </div>
    <NButton
      secondary
      :disabled="props.disabled"
      @click="selectFolder()"
    >
      {{ $t('select') }}
    </NButton>
  </div>
  <div
    v-else
    class="size-full flex items-center justify-center border border-surface-300 rounded-xl border-dashed bg-white p-4 dark:border-surface-700 dark:bg-black"
  >
    <NButton
      type="primary"
      :disabled="props.disabled"
      @click="selectFolder()"
    >
      {{ $t('select') }}
    </NButton>
  </div>
</template>
