<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'

import { NAvatar, NButton, NImage, NTooltip } from 'naive-ui'

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

const wallpaperUrl = computed(() => {
  if (props.device && props.userCustom?.wallpaper && props.currentConnectionPath) {
    const baseUrl = `http://${props.currentConnectionPath.remote_ipv4}:${props.device.port}`
    const { from, path } = props.userCustom.wallpaper
    if (from === 'Built-in') {
      return `${baseUrl}${path.startsWith('/images') ? '' : '/images'}${path}`
    }
    else if (from === 'Upload') {
      return props.userCustom.wallpaper.path.replace('SERVER_URL', baseUrl)
    }
    else {
      return ''
    }
  }
  else {
    return ''
  }
})

const avatarUrl = computed(() => {
  if (props.device && props.authentication && props.currentConnectionPath) {
    return `http://${props.currentConnectionPath.remote_ipv4}:${props.device.port}/v1/users/avatar?token=${props.authentication.access_token}`
  }
  return 'none'
})

const ipcRenderer = window.electron.ipcRenderer
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="h-10 flex select-none items-center justify-between -mb-2">
      <div v-if="!device || !authentication " class="flex items-center gap-4">
        <span class="text-2xl">
          Zima
        </span>
      </div>
      <div v-if="device && authentication " class="flex items-center gap-2">
        <NAvatar
          round :size="40"
          object-fit="cover"
          class="bg-surface-0 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-950"
          :src="avatarUrl"
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
        <NButton
          v-if="device && !authentication" type="primary" strong
          :disabled="!currentConnectionPath"
          @click="ipcRenderer.invoke('deviceWindow:show', 'Login')"
        >
          {{ $t('login') }}
        </NButton>
      </div>
      <AppMenu />
    </div>

    <!-- Find Zima New -->
    <FindZimaSingle v-if="!device" />

    <!-- Device Connection -->
    <div v-if="device" class="flex flex-col select-none gap-2 rounded-2xl bg-surface-100 p-2 ring-1 ring-[#333]/5 ring-inset dark:bg-surface-800">
      <button
        class="group/device relative h-48 overflow-hidden rounded-10px bg-surface-0 transition-colors transition-filter transition-shadow duration-500 dark:bg-surface-950"
        :class="{ 'hover:shadow-lg cursor-pointer': dashboardUrl }"
        :disabled="!dashboardUrl"
        @click="() => {
          if (dashboardUrl){
            ipcRenderer.invoke('shell:openExternal', dashboardUrl)
          }
        }"
      >
        <!-- Wallpaper -->
        <NImage
          v-if="wallpaperUrl"
          class="absolute inset-0"
          object-fit="cover"
          width="100%"
          height="100%"
          preview-disabled
          :src="wallpaperUrl"
        />
        <span
          class="absolute inset-0 size-full backdrop-brightness-80 dark:backdrop-brightness-60"
          :class="[{
            'backdrop-grayscale backdrop-brightness-40': !authentication,
          }]"
        />

        <!-- No Authentication -->
        <span
          v-if="currentConnectionPath && !authentication"
          class="absolute bottom-4 right-4 size-10 flex"
        >
          <i class="i-et:lock size-full text-transparent opacity-50 backdrop-blur-md backdrop-invert backdrop-saturate-3000" />
        </span>

        <!-- Device -->
        <div class="size-full flex flex-col justify-between rounded-10px bg-transparent p-3 dark:bg-surface-950/30">
          <!-- Device Name -->
          <div class="w-full flex justify-between">
            <span class="mask-text text-xl text-transparent backdrop-blur-md brightness-300 backdrop-grayscale backdrop-invert">
              {{ device.device_name || device.device_model || 'Zima' }}
            </span>
            <div class="flex items-center gap-2">
              <NTooltip
                placement="bottom"
                :to="false"
                :keep-alive-on-hover="false"
              >
                <template #trigger>
                  <NButton
                    circle
                    quaternary
                    class="group/disconnect hover:bg-surface-200/30!"
                    size="small"
                    @click.stop="disconnect()"
                  >
                    <template #icon>
                      <i class="i-bx:link group-hover/disconnect:i-bx:unlink opacity-0 backdrop-blur-md brightness-300 backdrop-grayscale backdrop-invert transition-opacity duration-500 text-transparent! group-hover/device:opacity-100" />
                    </template>
                  </NButton>
                </template>
                {{ $t('disconnect') }}
              </NTooltip>
              <NTooltip
                placement="bottom-end"
                :to="false"
                :keep-alive-on-hover="false"
                :disabled="!authentication"
              >
                <template #trigger>
                  <NButton
                    :circle="!!authentication"
                    :round="!authentication"
                    :quaternary="!!authentication"
                    :primary="!authentication"
                    :type="!authentication ? 'primary' : undefined"
                    :class="[
                      authentication
                        ? 'hover:bg-surface-200/30!'
                        : 'opacity-100 pl-2 pr-3 text-surface-0!',
                    ]"
                    class="group/user aspect-square" size="small" @click.stop="async () => {
                      if (!authentication) {
                        ipcRenderer.invoke('deviceWindow:show', 'Login')
                      }
                      else {
                        logout()
                      }
                    }"
                  >
                    <template #icon>
                      <i
                        :class="[
                          !authentication
                            ? 'i-mingcute:user-security-fill opacity-100!'
                            : [
                              'i-mingcute:user-3-fill group-hover/user:i-mingcute:user-x-fill ',
                              'group-hover/user:translate-x-[0.8px] ',
                              'text-transparent! backdrop-blur-md brightness-300 backdrop-grayscale backdrop-invert',
                              'opacity-0 transition-opacity duration-500 group-hover/device:opacity-100']]"
                      />
                    </template>
                    <template v-if="!authentication" #default>
                      {{ $t('login') }}
                    </template>
                  </NButton>
                </template>
                {{ authentication ? $t('logout') : $t('login') }}
              </NTooltip>
            </div>
          </div>
          <div class="flex items-start gap-2 *:transition-opacity *:duration-500">
            <!-- Dashboard -->
            <span class="mask-text text-3xl text-transparent leading-none backdrop-blur-md brightness-300 backdrop-grayscale backdrop-invert">
              {{ $t('dashboard') }}
            </span>
            <i class="i-iw:arrow-right-up size-7 text-transparent opacity-0 backdrop-blur-md brightness-300 backdrop-grayscale backdrop-invert group-hover/device:opacity-100" />
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
