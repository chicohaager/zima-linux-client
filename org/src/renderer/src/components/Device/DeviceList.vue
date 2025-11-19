<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'

export interface FoundDevice {
  deviceInfo: DeviceInfo
  connectionType: ConnectionMethod
  remoteIPv4: string
}

defineProps<{
  devices: FoundDevice[]
  lastDeviceHash?: string
  connect: () => void
}>()
const selectedDevice = defineModel<DeviceInfo>()

function selectDevice(device: DeviceInfo) {
  selectedDevice.value = device
}

const listElement = ref<HTMLElement | null>(null)
</script>

<template>
  <div class="app-no-drag relative grow-1 overflow-hidden -mx-3">
    <div ref="listElement" class="size-full flex flex-col gap-1 overflow-auto px-3">
      <DeviceItem
        v-for="device in devices"
        :key="device.deviceInfo.hash"
        :device="device"
        :selected="device.deviceInfo.hash === selectedDevice?.hash"
        :last="device.deviceInfo.hash === lastDeviceHash"
        @click="selectDevice(device.deviceInfo)"
        @dblclick="() => {
          selectDevice(device.deviceInfo)
          connect()
        }"
      />
    </div>
    <span
      v-if="false"
      class="pointer-events-none absolute left-0 top-0 min-h-15 w-full flex from-surface-0 to-surface-0/0 bg-gradient-to-b dark:from-surface-950 dark:to-surface-950/0"
    />
    <span
      v-if="false"
      class="pointer-events-none absolute bottom-0 left-0 min-h-15 w-full flex from-surface-0 to-surface-0/0 bg-gradient-to-t dark:from-surface-950 dark:to-surface-950/0"
    />
  </div>
</template>
