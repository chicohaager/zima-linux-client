<script setup lang="ts">
const ipcRenderer = window.electron.ipcRenderer
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-2 gap-1 *:h-30!">
      <IconCardButton
        icon-class="i-iw:general"
        name="Scan and connect Zima"
        @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingLanDiscovery')"
      />
      <IconCardButton
        icon-class="i-iw:network"
        name="Remote Access"
        @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingNetworkID')"
      />
    </div>
  </div>
</template>
