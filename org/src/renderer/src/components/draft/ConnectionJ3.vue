<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import type { DropdownMixedOption } from 'naive-ui/es/dropdown/src/interface'
import { NAvatar, NButton, NDropdown } from 'naive-ui'
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

const wallpaperUrl = computed(() => {
  if (props.authentication && props.device && props.currentConnectionPath) {
    const baseUrl = `http://${props.currentConnectionPath.remote_ipv4}:${props.device.port}`
    const defaultWallpaper = `${baseUrl}/images/wallpaper/zimaos01.jpg`
    if (props.userCustom?.wallpaper) {
      const { from, path } = props.userCustom.wallpaper
      if (from === 'Built-in') {
        return `${baseUrl}${path.startsWith('/images') ? '' : '/images'}${path}`
      }
      else if (from === 'Upload') {
        return props.userCustom.wallpaper.path.replace('SERVER_URL', baseUrl)
      }
      else {
        return defaultWallpaper
      }
    }
    else {
      return defaultWallpaper
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
const authedOptions = ref<DropdownMixedOption[]>([
  {
    label: t('logout'),
    key: 'logout',
    icon() {
      return h('i', { class: 'i-mingcute:user-x-line size-4 text-red-400 dark:text-red-500' })
    },
    props: {
      class: '*:text-red-400 *:dark:text-red-500',
      onClick: () => {
        props.logout()
      },
    },
  },
])
</script>

<template>
  <div class="relative flex flex-col gap-4">
    <!-- Header -->
    <div class="h-10 flex select-none items-center justify-between -mb-2">
      <!-- Title -->
      <div class="flex items-center gap-4 truncate pl-1">
        <span
          class="truncate text-2xl"
          :title="device?.device_name || device?.device_model || 'Zima'"
        >
          {{ device?.device_name || device?.device_model || 'Zima' }}
        </span>
      </div>

      <!-- Menu -->
      <AppMenu :options="extendOptions" />
    </div>

    <!-- Auth & Connection -->
    <div v-if="device" class="flex items-center justify-between">
      <!-- Connection Path -->
      <AvailableConnectionPaths
        v-if="device"
        :paths="availableConnectionPaths ?? []"
        :current="currentConnectionPath"
        show-connected
        size-class="size-5"
      />

      <!-- Auth -->
      <NDropdown
        placement="bottom-end"
        size="small"
        :trigger="authentication ? 'click' : 'manual'"
        :options="authentication ? authedOptions : []"
      >
        <NButton
          round
          :disabled="!currentConnectionPath"
          :secondary="!!authentication"
          :primary="!authentication && device"
          :type="!authentication ? 'primary' : undefined"
          class="h-7 pl-1.25 pr-2"
          @click.stop="async () => {
            if (!authentication) {
              ipcRenderer.invoke('deviceWindow:show', 'Login')
            }
            else {
              // logout()
            }
          }"
        >
          <template #icon>
            <NAvatar
              round
              object-fit="cover"
              class="size-7 shrink-0"
              :class="[
                authentication ? 'bg-surface-0 dark:bg-surface-950' : 'bg-transparent',
              ]"
              :src="avatarUrl"
            >
              <template #fallback>
                <div class="size-7 flex items-center justify-center">
                  <i
                    class="i-mingcute:user-3-fill size-4"
                    :class="[
                      authentication ? 'text-primary-500' : 'text-surface-0',
                    ]"
                  />
                </div>
              </template>
            </NAvatar>
          </template>
          <template v-if="device" #default>
            <span
              class="flex items-center text-sm leading-none"
              :class="[
                authentication ? 'pl-1.5' : 'pl-0.5',
              ]"
            >
              {{ authentication ? user?.username : $t('login') }}
            </span>
          </template>
        </NButton>
      </NDropdown>
    </div>

    <!-- Find Zima New -->
    <FindZimaSingle v-if="!device" />

    <div v-if="device" class="relative flex flex-col gap-4 p-3 -m-3">
      <!-- Dashboard -->
      <IconCardButton
        icon-class="i-hugeicons:dashboard-square-01"
        :name="$t('dashboard')"
        @click="() => ipcRenderer.invoke('shell:openExternal', dashboardUrl)"
      >
        <div class="relative size-full">
          <img
            v-if="wallpaperUrl" :src="wallpaperUrl"
            class="absolute right-0 h-full w-2/3 object-cover"
            :style="{
              maskImage: 'linear-gradient(to right, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.4) 100%)',
              maskSize: '100% 100%',
            }"
          >
          <span
            v-if="currentConnectionPath && !authentication"
            class="absolute inset-y-0 right-4 size-10 h-full flex"
          >
            <i class="i-mingcute:user-security-line size-full text-transparent opacity-50 backdrop-blur-md backdrop-invert backdrop-saturate-3000" />
          </span>
        </div>
      </IconCardButton>

      <!-- Explore -->
      <div class="relative flex p-2 -m-2">
        <Explore
          :user="user"
          :current-connection-path="currentConnectionPath"
        />
        <Transition
          name="fade"
          mode="out-in"
          :duration="700"
        >
          <div v-if="currentConnectionPath && !authentication" class="absolute inset-0 size-full flex items-center justify-center backdrop-blur-sm">
            <NButton
              v-if="false"
              secondary strong
              @click="ipcRenderer.invoke('deviceWindow:show', 'Login')"
            >
              {{ $t('login') }}
            </NButton>
          </div>
        </Transition>
      </div>

      <Transition
        name="fade"
        mode="out-in"
        :duration="700"
      >
        <div v-if="!currentConnectionPath" class="absolute inset-0 size-full flex items-center justify-center gap-1 backdrop-blur-sm">
          <i class="i-svg-spinners:bars-rotate-fade size-4" />
          <span class="leading-4">{{ $t('connecting') }}</span>
        </div>
      </Transition>
    </div>
  </div>
</template>
