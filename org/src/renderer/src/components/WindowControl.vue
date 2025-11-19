<script setup lang="ts">
const props = defineProps<{
  title?: string
  hide?: boolean
  hideTitle?: boolean
}>()

const ipcRenderer = window.electron.ipcRenderer
const platform = window.electron.process.platform

const maximizable = ref<boolean>()
const minimizable = ref<boolean>()
const closable = ref<boolean>()

const controlsCount = computed(() => {
  return [maximizable.value, minimizable.value].filter(value => value).length + 1
})

onMounted(() => {
  watch(
    () => props.title,
    (title) => {
      window.document.title = title ?? ''
    },
    { immediate: true },
  )

  ipcRenderer.invoke('window:isMaximizable').then((value) => {
    maximizable.value = value
  })

  ipcRenderer.invoke('window:isMinimizable').then((value) => {
    minimizable.value = value
  })

  ipcRenderer.invoke('window:isClosable').then((value) => {
    closable.value = value
  })
})
</script>

<template>
  <div
    class="app-drag fixed left-0 top-0 z-9999 w-vw flex items-center justify-between" :class="[
      {
        'h-28px px-8px': platform === 'darwin',
        'h-29px pl-8px': platform === 'win32',
      },
    ]"
  >
    <template v-if="platform === 'darwin'">
      <span class="h-full w-52px" />
      <span class="font-semibold" :class="{ invisible: hideTitle }">{{ title }}</span>
      <div class="min-w-52px flex items-center justify-end gap-8px">
        <slot />
      </div>
    </template>
    <template v-else>
      <span class="font-semibold" :class="{ invisible: hideTitle }">{{ title }}</span>
      <div class="h-full w-fit flex items-center justify-end gap-8px">
        <slot />
        <span
          class="h-full"
          :class="{
            'min-w-45.5px': controlsCount === 1,
            'min-w-91px': controlsCount === 2,
            'min-w-136.5px': controlsCount === 3,
          }"
        />
      </div>
    </template>
  </div>
</template>
