<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import type { DropdownMixedOption } from 'naive-ui/es/dropdown/src/interface'
import { NAvatar, NButton, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  device?: DeviceInfo
  authentication?: ConnectionAuthentication
  user?: User
  userCustom?: UserCustom
  currentConnectionPath?: ConnectionPath
  availableConnectionPaths?: ConnectionPath[]
  dashboardUrl?: string
  disconnect: () => void
  logout: () => void
}>()

const ipcRenderer = window.electron.ipcRenderer

const { t } = useI18n()

// const wallpaperUrl = computed(() => {
//   if (props.device && props.userCustom?.wallpaper && props.currentConnectionPath) {
//     const baseUrl = `http://${props.currentConnectionPath.remote_ipv4}:${props.device.port}`
//     const { from, path } = props.userCustom.wallpaper
//     if (from === 'Built-in') {
//       return `${baseUrl}${path.startsWith('/images') ? '' : '/images'}${path}`
//     }
//     else if (from === 'Upload') {
//       return props.userCustom.wallpaper.path.replace('SERVER_URL', baseUrl)
//     }
//     else {
//       return ''
//     }
//   }
//   else {
//     return ''
//   }
// })

const avatarUrl = computed(() => {
  if (props.device && props.authentication && props.currentConnectionPath) {
    return `http://${props.currentConnectionPath.remote_ipv4}:${props.device.port}/v1/users/avatar?token=${props.authentication.access_token}`
  }
  return 'none'
})

const extendOptions = computed<DropdownMixedOption[] | undefined>(() => {
  if (props.device) {
    return [{
      label: t('disconnect'),
      icon() {
        return h('i', { class: 'i-iw:unlink size-4' })
      },
      key: 'disconnect',
      props: {
        onClick: () => {
          props.disconnect()
        },
      },
    }]
  }
  else {
    return undefined
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="h-10 flex select-none items-center justify-between -mb-2">
      <!-- Title -->
      <div class="flex items-center gap-4">
        <span class="text-2xl">
          {{ device?.device_name || device?.device_model || 'Zima' }}
        </span>
      </div>
      <!-- Actions -->
      <div class="flex items-center gap-2">
        <AppMenu :options="extendOptions" />
      </div>
    </div>

    <!-- Find Zima New -->
    <FindZimaSingle v-if="!device" />

    <!-- Device Connection -->
    <div v-if="device" class="flex flex-col select-none gap-2 rounded-2xl bg-surface-200 p-2 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-700">
      <button
        class="group/device relative aspect-ratio-21/9 overflow-hidden rounded-10px bg-surface-0 transition-colors transition-filter transition-shadow duration-500 dark:bg-surface-950"
        :class="{ 'hover:shadow-lg cursor-pointer': dashboardUrl }"
        :disabled="!dashboardUrl"
        @click="() => {
          if (dashboardUrl){
            ipcRenderer.invoke('shell:openExternal', dashboardUrl)
          }
        }"
      >
        <!-- No Authentication -->
        <span
          v-if="currentConnectionPath && !authentication"
          class="absolute bottom-4 right-4 size-10 flex"
        >
          <i class="i-et:lock size-full text-transparent opacity-50 backdrop-blur-md backdrop-invert backdrop-saturate-3000" />
        </span>

        <!-- Device -->
        <div class="size-full flex flex-col justify-between rounded-10px bg-transparent p-3 dark:bg-surface-950/30">
          <!-- Dashboard -->
          <div class="w-full flex justify-between">
            <div class="flex items-center gap-2">
              <NTooltip
                placement="right"
                :to="false"
                :keep-alive-on-hover="false"
                :disabled="!authentication"
              >
                <template #trigger>
                  <NButton
                    round
                    :secondary="!!authentication"
                    :primary="!authentication"
                    :type="!authentication ? 'primary' : undefined"
                    :class="[{ 'text-surface-0!': !authentication }]"
                    size="small"
                    class="pl-1.25 pr-3"
                    @click.stop="async () => {
                      if (!authentication) {
                        ipcRenderer.invoke('deviceWindow:show', 'Login')
                      }
                      else {
                        logout()
                      }
                    }"
                  >
                    <template #icon>
                      <NAvatar
                        round
                        size="small"
                        object-fit="cover"
                        class="size-6 shrink-0 bg-surface-0 dark:bg-surface-950"
                        :src="avatarUrl"
                      >
                        <template #fallback>
                          <div class="size-6 flex items-center justify-center">
                            <i class="i-mingcute:user-3-fill size-4 text-primary-500" :class="{ 'filter-grayscale': !authentication }" />
                          </div>
                        </template>
                      </NAvatar>
                    </template>
                    <template #default>
                      <span
                        v-if="authentication"
                        class="pl-1 text-sm text-surface-900 dark:text-surface-50"
                      >
                        {{ user?.username }}
                      </span>
                      <span v-else class="pl-1">
                        {{ $t('login') }}
                      </span>
                    </template>
                  </NButton>
                </template>
                {{ authentication ? $t('logout') : $t('login') }}
              </NTooltip>
            </div>
          </div>
          <div class="flex items-end gap-2">
            <!-- Dashboard -->
            <span class="text-2xl text-surface-900 leading-none dark:text-surface-50">
              {{ $t('dashboard') }}
            </span>
          </div>
        </div>
      </button>
      <div class="flex items-center justify-between px-1">
        <CurrentConnectionPath :path="currentConnectionPath" />
        <AvailableConnectionPaths :paths="availableConnectionPaths ?? []" />
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
