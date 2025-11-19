<script setup lang="ts">
import { NButton, NCard, NInput } from 'naive-ui'

const ipcRenderer = window.electron.ipcRenderer

const networkId = ref('')
const gettingByNetworkId = ref(false)
function getDeviceByNetworkId() {
  gettingByNetworkId.value = true
  ipcRenderer.invoke('device:getByNetworkId', networkId.value)
    .then(console.log)
    .catch(console.error)
    .finally(() => {
      gettingByNetworkId.value = false
    })
}

const ip = ref('')
const gettingByIp = ref(false)
function getDeviceByIp() {
  gettingByIp.value = true
  ipcRenderer.invoke('device:getByIP', ip.value)
    .then(console.log)
    .catch(console.error)
    .finally(() => {
      gettingByIp.value = false
    })
}

onMounted(() => {
  ipcRenderer.on('device:discover:found', (_event, ...args) => {
    console.log(args)
  })
})

onBeforeUnmount(() => {
  ipcRenderer.removeAllListeners('device:discover:found')
})
</script>

<template>
  <div class="size-full flex flex-col items-center justify-center gap-4">
    <span class="pb-4 text-3xl text-surface-950 dark:text-surface-0"> Device </span>
    <NCard class="w-fit" size="small">
      <div class="w-fit flex flex-col items-center gap-3">
        <span class="text-xl text-surface-950 leading-none dark:text-surface-0"> UDP Discovery </span>
        <NButton
          primary
          @click="ipcRenderer.invoke('device:discover')"
        >
          Discover Device
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('device:discover', 'wifi')"
        >
          Discover Device (WiFi)
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('device:discover', 'ethernet')"
        >
          Discover Device (Ethernet)
        </NButton>
        <NButton
          primary
          @click="ipcRenderer.invoke('device:discover', 'thunderbolt')"
        >
          Discover Device (Thunderbolt)
        </NButton>
      </div>
    </NCard>
    <NCard class="w-fit" size="small">
      <div class="w-fit flex flex-col items-center gap-3">
        <span class="text-xl text-surface-950 leading-none dark:text-surface-0"> Network ID </span>
        <NInput v-model:value="networkId" type="text" placeholder="Network ID" bordered clearable />
        <NButton
          primary
          :loading="gettingByNetworkId"
          :disabled="!networkId || gettingByNetworkId"
          @click="getDeviceByNetworkId"
        >
          Get Device
        </NButton>
      </div>
    </NCard>
    <NCard class="w-fit" size="small">
      <div class="w-fit flex flex-col items-center gap-3">
        <span class="text-xl text-surface-950 leading-none dark:text-surface-0"> IP </span>
        <NInput v-model:value="ip" type="text" placeholder="IP" bordered clearable />
        <NButton
          primary
          :loading="gettingByIp"
          :disabled="!ip || gettingByIp"
          @click="getDeviceByIp"
        >
          Get Device
        </NButton>
      </div>
    </NCard>
  </div>
</template>
