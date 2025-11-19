<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { FoundDevice } from '@renderer/components/Device/DeviceList.vue'
import { Config } from '@renderer/utils/config'
import { Connection } from '@renderer/utils/connection'
import { NButton, NProgress } from 'naive-ui'
import semver from 'semver'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

const ipcRenderer = window.electron.ipcRenderer
const { t } = useI18n()
const router = useRouter()

const lastDeviceHash = ref<string>()

const foundThunderboltDevices = ref<FoundDevice[]>([])
const foundEthernetDevices = ref<FoundDevice[]>([])
const foundWifiDevices = ref<FoundDevice[]>([])
const foundDevices = computed(() => {
  return [
    ...foundThunderboltDevices.value,
    ...foundEthernetDevices.value,
    ...foundWifiDevices.value,
  ]
})
const selectedDevice = ref<DeviceInfo>()

const MIN_DISCOVERY_TIME = 5000
const discoveryProgress = ref(0)
const discovering = ref(true)
function startDiscovery() {
  // Clear all found devices
  selectedDevice.value = undefined
  foundThunderboltDevices.value = []
  foundEthernetDevices.value = []
  foundWifiDevices.value = []

  // Reset progress
  discoveryProgress.value = 0

  // Start discovery
  discovering.value = true
  ipcRenderer.invoke('device:discover')

  // Wait for discovery to end
  const discoveryStartTime = Date.now()
  const progressInterval = setInterval(() => {
    // Increase progress by 33% every second
    discoveryProgress.value += Math.floor((100 - discoveryProgress.value) / 3)
  }, 1000)
  ipcRenderer.once('device:discover:ended', () => {
    // Wait for at least 5 seconds
    const discoveryTime = Date.now() - discoveryStartTime
    setTimeout(() => {
      // Clear progress interval and set progress to 100
      clearInterval(progressInterval)
      discoveryProgress.value = 100

      // Wait for progress bar to finish
      setTimeout(() => {
        discovering.value = false
      }, 500)

      // Select the first device found
      if (foundDevices.value.length > 0 && !selectedDevice.value) {
        const lastDevice = foundDevices.value.find(device => device.deviceInfo.hash === lastDeviceHash.value)?.deviceInfo
        const targetDevice = lastDevice ?? foundDevices.value[0].deviceInfo
        selectedDevice.value = targetDevice && semver.gte(targetDevice.os_version!, import.meta.env.VITE_MIN_OS_VERSION)
          ? targetDevice
          : undefined
      }
    }, Math.max(MIN_DISCOVERY_TIME - discoveryTime, 0))
  })
}

function connectDevice() {
  if (selectedDevice.value) {
    Config.set('device.lastDeviceHash', selectedDevice.value.hash)
    const device = selectedDevice.value
    const remoteIPv4 = foundDevices.value.find(fd => fd.deviceInfo.hash === device.hash)!.remoteIPv4
    Connection.setDevice(toRaw(device)).then(() => {
      if (device.initialized) {
        router.replace('/Device/Login')
      }
      else {
        ipcRenderer.invoke('shell:openExternal', `http://${remoteIPv4}:${device.port}`)
        ipcRenderer.invoke('window:close')
      }
    }).catch((err) => {
      console.error(err)
    })
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    if (selectedDevice.value) {
      connectDevice()
    }
  }
}

onMounted(() => {
  window.document.title = t('connectUsingLanDiscovery')

  document.addEventListener('keydown', onKeydown)

  Config.get('device.lastDeviceHash')
    .then((value) => {
      lastDeviceHash.value = value
    })

  ipcRenderer.on('device:discover:found', (_event, ...args) => {
    const deviceInfo = args[0] as DeviceInfo
    const connectionType = args[1] as ConnectionMethod
    const remoteIPv4 = args[2] as string

    if (
      connectionType === 'thunderbolt'
      && !foundThunderboltDevices.value.some(device => device.deviceInfo.hash === deviceInfo.hash)
    ) {
      foundThunderboltDevices.value.push({
        deviceInfo,
        connectionType,
        remoteIPv4,
      })
    }
    else if (
      connectionType === 'ethernet'
      && !foundEthernetDevices.value.some(device => device.deviceInfo.hash === deviceInfo.hash)
    ) {
      foundEthernetDevices.value.push({
        deviceInfo,
        connectionType,
        remoteIPv4,
      })
    }
    else if (
      connectionType === 'wifi'
      && !foundWifiDevices.value.some(device => device.deviceInfo.hash === deviceInfo.hash)
    ) {
      foundWifiDevices.value.push({
        deviceInfo,
        connectionType,
        remoteIPv4,
      })
    }

    // Keep only unique and best connection type
    foundThunderboltDevices.value.forEach((device, _index) => {
      // Remove all other devices with the same hash
      foundEthernetDevices.value = foundEthernetDevices.value.filter(
        ethDevice => ethDevice.deviceInfo.hash !== device.deviceInfo.hash,
      )
      foundWifiDevices.value = foundWifiDevices.value.filter(
        wifiDevice => wifiDevice.deviceInfo.hash !== device.deviceInfo.hash,
      )
    })

    foundEthernetDevices.value.forEach((device, _index) => {
      // Remove all other devices with the same hash
      foundWifiDevices.value = foundWifiDevices.value.filter(
        wifiDevice => wifiDevice.deviceInfo.hash !== device.deviceInfo.hash,
      )
    })

    // Make sure last connected device is always on top in each connection type
    if (lastDeviceHash.value) {
      const lastDevice = foundDevices.value.find(device => device.deviceInfo.hash === lastDeviceHash.value)
      if (lastDevice) {
        if (lastDevice.connectionType === 'thunderbolt') {
          foundThunderboltDevices.value = [lastDevice, ...foundThunderboltDevices.value.filter(device => device.deviceInfo.hash !== lastDeviceHash.value)]
        }
        else if (lastDevice.connectionType === 'ethernet') {
          foundEthernetDevices.value = [lastDevice, ...foundEthernetDevices.value.filter(device => device.deviceInfo.hash !== lastDeviceHash.value)]
        }
        else if (lastDevice.connectionType === 'wifi') {
          foundWifiDevices.value = [lastDevice, ...foundWifiDevices.value.filter(device => device.deviceInfo.hash !== lastDeviceHash.value)]
        }
      }
    }
  })

  startDiscovery()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)

  ipcRenderer.removeAllListeners('device:discover:found')
  ipcRenderer.removeAllListeners('device:discover:ended')
})
</script>

<template>
  <div class="relative size-full flex flex-col select-none justify-between gap-4">
    <!-- Title -->
    <div class="flex justify-between">
      <span class="text-4xl">
        {{
          discovering
            ? $t('discoveringDevices')
            : foundDevices.length > 0
              ? $t('selectDevice')
              : $t('noDevicesFound')
        }}
      </span>
      <NButton
        v-if="!discovering"
        class="app-no-drag"
        @click="startDiscovery"
      >
        {{ $t('refresh') }}
      </NButton>
    </div>

    <!-- Progress Bar -->
    <Transition
      leave-from-class="max-h-12 opacity-100 mb-0"
      leave-active-class="transition-[max-height,opacity,margin] duration-500"
      leave-to-class="max-h-0 opacity-0 -mb-4"
    >
      <div v-if="discovering" class="flex flex-col gap-4">
        <NProgress :percentage="discoveryProgress" :show-indicator="false" processing :border-radius="0" :height="4" />
      </div>
    </Transition>

    <!-- Device List -->
    <Transition
      leave-from-class="opacity-100"
      leave-active-class="transition-opacity duration-500"
      leave-to-class="opacity-0"
    >
      <DeviceList
        v-if="discovering || (!discovering && foundDevices.length > 0)"
        v-model="selectedDevice"
        :devices="foundDevices"
        :last-device-hash="lastDeviceHash"
        :connect="connectDevice"
      />
    </Transition>

    <!-- No Devices found -->

    <div v-if="!discovering && foundDevices.length === 0" class="absolute inset-y-0 h-full flex flex-col justify-center gap-3">
      <span class="whitespace-pre-line text-surface-500">
        {{ $t('noDevicesFoundTip') }}
      </span>
      <i18n-t keypath="noDevciesFoundConnectUsingNetworkIdTip" tag="span" class="text-surface-500">
        <template #action>
          <RouterLink to="/Device/ConnectUsingNetworkID" replace>
            <NButton text>
              {{ $t('connectUsingNetworkID') }}
            </NButton>
          </RouterLink>
        </template>
      </i18n-t>
    </div>

    <!-- Buttons -->
    <div class="flex items-center justify-between">
      <div class="flex items-center">
        <RouterLink to="/Device/ConnectUsingNetworkID" replace>
          <NButton quaternary type="primary">
            {{ $t('connectUsingNetworkID') }}
          </NButton>
        </RouterLink>
      </div>
      <div class="flex items-center gap-3">
        <NButton :disabled="!selectedDevice" type="primary" @click="connectDevice">
          {{ $t('connect') }}
        </NButton>
      </div>
    </div>
  </div>
</template>
