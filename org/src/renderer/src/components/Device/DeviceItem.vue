<script setup lang="ts">
import type { FoundDevice } from './DeviceList.vue'
import { Connection } from '@renderer/utils/connection'
import { openExternal } from '@renderer/utils/shell'
import { NTooltip } from 'naive-ui'
import semver from 'semver'

const props = defineProps<{
  device: FoundDevice
  selected: boolean
  last: boolean
  onClick: () => void
  onDblclick: () => void
}>()

const devOsVerLtMinOsVer = computed(() => {
  return semver.lt(semver.coerce(props.device.deviceInfo.os_version!)!, import.meta.env.VITE_MIN_OS_VERSION)
})
</script>

<template>
  <button
    class="flex appearance-none items-center justify-between border border-transparent rounded-lg bg-surface-50 p-3 transition-colors active:border-primary-500 focus-visible:border-primary-500 active:bg-surface-200 dark:bg-surface-900 hover:bg-surface-100 focus-visible:outline-none dark:active:border-primary-600 dark:active:bg-surface-700 dark:hover:bg-surface-800"
    :class="{ 'border-primary-500! dark:border-primary-600! bg-surface-100! dark:bg-surface-800!': selected }"
    @click="() => {
      if (devOsVerLtMinOsVer){
        openExternal(`http://${device.remoteIPv4}:${device.deviceInfo.port ?? 80}`)
      }
      else {
        onClick()
      }
    }"
    @dblclick="() => {
      if (!devOsVerLtMinOsVer){
        onDblclick()
      }
    } "
  >
    <div class="flex items-center gap-2">
      <span class="text-sm">{{ device.deviceInfo.device_name }}</span>
      <span v-if="last" class="text-xs opacity-50">
        {{ $t('lastConnected') }}
      </span>
    </div>
    <div class="flex items-center gap-2">
      <NTooltip placement="left">
        <template #trigger>
          <span
            class="size-4" :class="[
              devOsVerLtMinOsVer
                ? 'i-ant-design:arrow-up-outlined text-primary-500'
                : Connection.IconClass(device.connectionType)]"
          />
        </template>
        {{
          devOsVerLtMinOsVer
            ? $t('deviceOsNeedsUpdate')
            : Connection.MethodName(device.connectionType)
        }}
      </NTooltip>
      <span class="text-sm">{{ device.remoteIPv4 }}</span>
    </div>
  </button>
</template>
