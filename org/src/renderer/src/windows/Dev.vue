<script setup lang="ts">
import { NTabPane, NTabs } from 'naive-ui'

onMounted(() => {
  window.document.title = 'Dev'
})
</script>

<template>
  <div class="h-vh w-vw flex items-center justify-center bg-surface-50 dark:bg-surface-900">
    <NTabs type="card" placement="left" animated class="size-full px-3">
      <template #prefix>
        <span class="py-2 text-3xl text-surface-950 dark:text-surface-0"> Dev </span>
      </template>
      <NTabPane name="windows-manager" tab="Windows">
        <WindowsManager />
      </NTabPane>
      <NTabPane name="zerotier-service" tab="ZeroTier Service">
        <ZeroTier />
      </NTabPane>
      <NTabPane name="device-manager" tab="Device">
        <DeviceManager />
      </NTabPane>
      <NTabPane name="config-manager" tab="Config">
        <ConfigManager />
      </NTabPane>
    </NTabs>
  </div>
</template>
