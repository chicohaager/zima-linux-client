<script setup lang="ts">
import { Config } from '@renderer/utils/config'
import { NButton, NInput } from 'naive-ui'

const store = ref()

function getStore() {
  Config.store().then((value) => {
    store.value = value
  })
}

function clearStore() {
  Config.clear().then(() => {
    getStore()
  })
}

onMounted(() => {
  getStore()
})
</script>

<template>
  <div class="size-full flex flex-col items-center justify-center gap-4">
    <span class="pb-4 text-3xl text-surface-950 dark:text-surface-0"> Config </span>
    <NInput
      :value="JSON.stringify(store, null, 2)"
      type="textarea"
      readonly
      :autosize="{
        minRows: 8,
        maxRows: 20,
      }"
      class="max-h-60vh"
    />
    <NButton
      primary
      @click="getStore"
    >
      Refresh
    </NButton>
    <NButton
      primary
      @click="clearStore"
    >
      Clear
    </NButton>
  </div>
</template>
