<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'

const ipcRenderer = window.electron.ipcRenderer

defineModel<{
  device: DeviceInfo
}>()
</script>

<template>
  <IconCardButton
    :name="$t('connectToZima')"
    icon-class="i-iw:arrow-right-up"
    @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingLanDiscovery')"
  />
</template>
