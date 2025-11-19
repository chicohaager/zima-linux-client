<script setup lang="ts">
import { NButton, NCard } from 'naive-ui'

const ipcRenderer = window.electron.ipcRenderer
</script>

<template>
  <div class="size-full flex flex-col items-center justify-center gap-4">
    <span class="pb-4 text-3xl text-surface-950 dark:text-surface-0"> Windows </span>
    <NButton
      primary
      @click="ipcRenderer.invoke('initializationWindow:show')"
    >
      Initialization
    </NButton>

    <NCard class="w-fit" size="small">
      <div class="w-fit flex flex-col items-center gap-3">
        <span class="text-xl text-surface-950 leading-none dark:text-surface-0"> Device </span>
        <NButton
          primary
          @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingLanDiscovery')"
        >
          Connect using LAN Discovery
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingNetworkID')"
        >
          Connect using Network ID
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('deviceWindow:show', 'ConnectUsingIP')"
        >
          Connect using IP
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('deviceWindow:show', 'Login')"
        >
          Login
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('deviceWindow:show', 'LoginSuccess')"
        >
          Login Success
        </NButton>
      </div>
    </NCard>

    <NButton
      primary
      @click="ipcRenderer.invoke('mainWindow:show')"
    >
      Main
    </NButton>
  </div>
</template>
