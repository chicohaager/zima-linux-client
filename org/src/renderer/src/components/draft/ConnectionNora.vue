<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import lanSvg from '@renderer/assets/images/bg/lan.svg'
import remoteSvg from '@renderer/assets/images/bg/remote.svg'
import thunderboltSvg from '@renderer/assets/images/bg/thunderbolt.svg'

import { NAvatar, NButton, NTooltip } from 'naive-ui'

const props = defineProps<{
  device?: DeviceInfo
  authentication?: ConnectionAuthentication
  user?: User
  currentConnectionPath?: ConnectionPath
  availableConnectionPaths?: ConnectionPath[]
  dashboardUrl?: string
  disconnect: () => void
}>()

const ipcRenderer = window.electron.ipcRenderer

const bgSvgUrl = computed(() => {
  if (props.currentConnectionPath?.method === 'thunderbolt') {
    return thunderboltSvg
  }
  else if (props.currentConnectionPath?.method === 'ethernet' || props.currentConnectionPath?.method === 'wifi') {
    return lanSvg
  }
  else if (props.currentConnectionPath?.method === 'remote') {
    return remoteSvg
  }
  return ''
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="h-10 flex select-none items-center justify-between">
      <div class="flex items-center gap-2">
        <NAvatar
          round :size="40"
          object-fit="cover"
          class="bg-surface-0 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-950"
          :src="`http://${currentConnectionPath?.remote_ipv4}:${device?.port}/v1/users/avatar?token=${authentication?.access_token}`"
        >
          <template #fallback>
            <div class="size-full flex items-center justify-center">
              <i class="i-mingcute:user-3-fill size-8 flex text-primary-500" :class="{ 'filter-grayscale': !authentication }" />
            </div>
          </template>
        </NAvatar>
        <span v-if="authentication" class="text-base text-surface-900 dark:text-surface-50">
          {{ user?.nickname || user?.username }}
        </span>
      </div>
      <AppMenu />
    </div>

    <!-- Find Zima -->
    <FindZimaNora v-if="!device" />

    <!-- Device Connection -->
    <div v-if="device" class="relative flex flex-col select-none gap-2 overflow-hidden rounded-xl bg-surface-200 p-1 pb-2 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-700">
      <!-- Device -->
      <div class="group/device relative h-48 flex flex-col justify-between overflow-hidden rounded-10px bg-surface-0 p-3 dark:bg-surface-950">
        <!-- BG -->
        <span
          v-if="bgSvgUrl"
          class="absolute h-50 w-50 object-cover -right-7.5 -top-12 dark:brightness-90 dark:filter-invert"
          :style="{ backgroundImage: `url(${bgSvgUrl})` }"
        />
        <!-- Hostname -->
        <div class="relative flex items-start justify-between gap-4">
          <span class="truncate text-3xl text-surface-900 dark:text-surface-100">
            {{ device?.device_name || device?.device_model || 'Zima' }}
          </span>
          <div class="relative flex items-center gap-2">
            <NTooltip placement="bottom-end">
              <template #trigger>
                <NButton
                  class="aspect-square px-0 opacity-0 group-hover/device:opacity-100" size="small"
                  @click="disconnect"
                >
                  <template #icon>
                    <i class="i-bx:unlink size-4 text-surface-400 dark:text-surface-500" />
                  </template>
                </NButton>
              </template>
              {{ $t('disconnect') }}
            </NTooltip>
          </div>
        </div>
        <div class="relative grid grid-cols-2 h-20 w-full gap-2">
          <!-- Dashboard -->
          <button
            class="h-full cursor-pointer justify-between rounded-lg bg-surface-50 p-3 text-left ring-1 ring-[#333]/5 ring-inset dark:bg-surface-900"
            @click="() => {
              if (dashboardUrl) {
                ipcRenderer.invoke('shell:openExternal', dashboardUrl)
              }
            }"
          >
            <div class="h-full w-full flex flex-col justify-between">
              <div class="flex items-center justify-between text-xs text-surface-400 dark:text-surface-600">
                <span>IP & Dashboard</span>
                <i class="i-iw:arrow-right-up size-4 flex text-base leading-none" />
              </div>
              <span class="text-base text-surface-900 dark:text-surface-100">
                {{ currentConnectionPath?.remote_ipv4 }}
              </span>
            </div>
          </button>
          <!-- State -->
          <div class="h-full justify-between rounded-lg bg-surface-50 p-3 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-900">
            <div class="h-full w-full flex flex-col justify-between">
              <div class="flex items-center justify-between text-xs text-surface-400 dark:text-surface-600">
                <span>State</span>
              </div>
              <div class="flex gap-1">
                <i v-for="_ in 21" :key="_" class="h-4 w-0.5 shrink-0" :class="[_ < 20 ? 'bg-green-500' : 'bg-surface-300']" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Connection Paths -->
      <div class="flex items-center justify-between px-3">
        <div class="flex items-center gap-1">
          <LeoSelectLable
            text="Thunderbolt"
            :light="availableConnectionPaths?.some((path) => path.method === 'thunderbolt')"
            :selected="currentConnectionPath?.method === 'thunderbolt'"
          />
          <LeoSelectLable
            text="LAN"
            :light="availableConnectionPaths?.some((path) => path.method === 'ethernet' || path.method === 'wifi')"
            :selected="currentConnectionPath?.method === 'ethernet' || currentConnectionPath?.method === 'wifi'"
          />
        </div>
        <LeoSelectLable
          text="Remote available"
          :light="availableConnectionPaths?.some((path) => path.method === 'remote')"
          :selected="currentConnectionPath?.method === 'remote'"
        />
      </div>

      <!-- Action Required Overlay -->
      <div v-if="!authentication || !device.initialized" class="absolute inset-0 size-full flex items-center justify-center bg-surface-0/30 backdrop-blur-sm dark:bg-surface-950/30">
        <NButton
          v-if="!authentication && device.initialized" type="primary" strong
          :disabled="!currentConnectionPath"
          @click="ipcRenderer.invoke('deviceWindow:show', 'Login')"
        >
          {{ $t('login') }}
        </NButton>

        <NButton
          v-if="!device.initialized" type="primary" strong
          :disabled="!dashboardUrl"
          @click="ipcRenderer.invoke('shell:openExternal', dashboardUrl)"
        >
          {{ `Start using ${device.device_model ?? device.device_name}` }}
        </NButton>
      </div>
    </div>

    <!-- Explore -->
    <Transition
      enter-from-class="max-h-0 opacity-0"
      enter-active-class="transition-[max-height,opacity,colors] duration-700"
      enter-to-class="max-h-40 opacity-100"
      leave-from-class="max-h-40 opacity-100"
      leave-active-class="transition-[max-height,opacity,colors] duration-700"
      leave-to-class="max-h-0 opacity-0"
    >
      <Explore
        v-if="device && authentication"
        :user="user"
        :current-connection-path="currentConnectionPath"
      />
    </Transition>
  </div>
</template>
