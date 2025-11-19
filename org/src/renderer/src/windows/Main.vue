<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import { Connection } from '@renderer/utils/connection'
import { useElementSize } from '@vueuse/core'
import { NDialogProvider } from 'naive-ui'
import qs from 'qs'

const ipcRenderer = window.electron.ipcRenderer

const winElRef = ref<HTMLElement | null>(null)
const { height } = useElementSize(winElRef)

const device = ref<DeviceInfo>()
const currentConnectionPath = ref<ConnectionPath>()
const availableConnectionPaths = ref<ConnectionPath[]>([])
const authentication = ref<ConnectionAuthentication>()

const user = ref<User>()
const userCustom = ref<UserCustom>({})

const dashboardUrl = computed(() => {
  if (device.value && currentConnectionPath.value) {
    const suffix = authentication.value ? `/#?${qs.stringify({ token: authentication.value.access_token, refresh_token: authentication.value.refresh_token })}` : ''
    return `http://${currentConnectionPath.value.remote_ipv4}:${device.value.port}${suffix}`
  }
  return ''
})

function getUserInfos() {
  Connection.getUser().then((res) => {
    user.value = res
  })

  Connection.getUserCustom().then((res) => {
    userCustom.value = res
  })
}

function getInfos() {
  Connection.getDevice().then((dev) => {
    device.value = dev
    if (dev) {
      Connection.getCurrentConnectionPath().then((path) => {
        currentConnectionPath.value = path
      })
      Connection.getAvailableConnectionPaths().then((paths) => {
        availableConnectionPaths.value = paths
      })
      Connection.getAuthentication().then((auth) => {
        authentication.value = auth
      })
    }
    else {
      currentConnectionPath.value = undefined
      availableConnectionPaths.value = []
    }
  })
}

function disconnect() {
  Connection.setDevice(undefined)
  device.value = undefined
  authentication.value = undefined
  user.value = undefined
  userCustom.value = {}
  currentConnectionPath.value = undefined
  availableConnectionPaths.value = []
}

function logout() {
  authentication.value = undefined
  Connection.logout().then(() => {
    getInfos()
    getUserInfos()
  })
}

onMounted(() => {
  // Set body overflow-hidden to prevent scrollbars
  document.body.classList.add('overflow-hidden')
  document.body.setAttribute('tabindex', '-1')

  // Auto resize window
  watch(
    () => height.value,
    (value) => {
      if (value > 0) {
        ipcRenderer.invoke('window:resize', 360, Math.ceil(value), true)
      }
    },
    { immediate: true },
  )

  // Auto get device infos
  setInterval(() => {
    getInfos()
    getUserInfos()
  }, 1000)
  getInfos()
  getUserInfos()
})
</script>

<template>
  <NDialogProvider>
    <div ref="winElRef" class="h-fit w-360px overflow-visible bg-surface-50 dark:bg-surface-900">
      <div class="flex flex-col gap-4 p-4">
        <ConnectionSection
          :device="device"
          :authentication="authentication"
          :user="user"
          :current-connection-path="currentConnectionPath"
          :available-connection-paths="availableConnectionPaths"
          :dashboard-url="dashboardUrl"
          :disconnect="disconnect"
          :logout="logout"
        />
      </div>
    </div>
  </NDialogProvider>
</template>
