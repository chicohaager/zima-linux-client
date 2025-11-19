<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'
import type { DropdownMixedOption } from 'naive-ui/es/dropdown/src/interface'

import { NButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  device?: DeviceInfo
  authentication?: ConnectionAuthentication
  user?: User
  currentConnectionPath?: ConnectionPath
  availableConnectionPaths?: ConnectionPath[]
  dashboardUrl?: string
  disconnect: () => void
  logout: () => void
}>()

const { t } = useI18n()

const ipcRenderer = window.electron.ipcRenderer

const extendOptions = computed<DropdownMixedOption[] | undefined>(() => {
  if (props.device) {
    return [
      {
        label: t('disconnect'),
        icon() {
          return h('i', { class: 'i-iw:unlink' })
        },
        key: 'disconnect',
        props: {
          onClick: () => {
            props.disconnect()
          },
        },
      },
      ...(
        props.authentication
          ? [
              {
                type: 'divider',
              },
              {
                label: props.user?.username,
                icon() {
                  return h('i', { class: 'i-mdi:account-outline' })
                },
                key: 'logout',
                children: [
                  {
                    label: t('logout'),
                    icon() {
                      return h('i', { class: 'i-mdi:account-off-outline' })
                    },
                    key: 'logout',
                    props: {
                      onClick: () => {
                        props.logout()
                      },
                    },
                  },
                ],
              },
            ]
          : props.device.initialized
            ? [
                {
                  type: 'divider',
                },
                {
                  label: t('login'),
                  icon() {
                    return h('i', { class: 'i-mdi:account-outline' })
                  },
                  key: 'login',
                  props: {
                    onClick: () => {
                      ipcRenderer.invoke('deviceWindow:show', 'Login')
                    },
                  },
                },
              ]
            : []
      ),

    ]
  }
  else {
    return undefined
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Header -->
    <div class="h-10 flex select-none items-center justify-between">
      <div class="flex items-center gap-2">
        <!-- Title -->
        <div class="flex items-center gap-4 truncate pl-1">
          <span
            class="truncate text-3xl"
            :title="device?.device_name || device?.device_model || 'Zima'"
          >
            {{ device?.device_name || device?.device_model || 'Zima' }}
          </span>
        </div>
      </div>
      <AppMenu
        menu-size="small"
        :options="extendOptions"
      />
    </div>

    <!-- Find Zima -->
    <FindZimaSingle v-if="!device" />

    <!-- Device Connection -->
    <div v-if="device" class="relative flex flex-col justify-between gap-3 overflow-hidden border border-#333/13 rounded-xl bg-surface-0 p-3 dark:border-#fff/13 dark:bg-surface-950">
      <!-- Device Model Banner -->
      <ModelBanner :device="device" />

      <div class="relative flex flex-col justify-between gap-3">
        <!-- Connection Info -->
        <div class="relative">
          <div
            class="flex flex-col *:h-11 *:border *:border-#333/13 *:bg-surface-50 *:p-3 dark:*:border-#fff/13 dark:*:bg-surface-900"
          >
            <!-- Connection Path -->
            <div class="flex items-center justify-between rounded-t-lg">
              <span class="select-none text-surface-400 dark:text-surface-500">
                {{ $t('connection') }}
              </span>
              <AvailableConnectionPaths
                v-if="device"
                :paths="availableConnectionPaths ?? []"
                :current="currentConnectionPath"
                show-connected
              />
            </div>
            <!-- Current IP -->
            <div class="flex items-center justify-between rounded-b-lg border-t-none">
              <span class="select-none text-surface-400 dark:text-surface-500">
                {{ $t('currentIP') }}
              </span>
              <span class="select-all text-sm text-surface-900 font-mono dark:text-surface-50">{{ currentConnectionPath?.remote_ipv4 }}</span>
            </div>
          </div>
          <!-- Connecting Overlay -->
          <Transition
            name="fade"
            mode="out-in"
            :duration="700"
          >
            <div
              v-if="!authentication || !device.initialized"
              class="absolute inset-0 flex items-center justify-center gap-1 backdrop-blur-sm -m-2"
            />
          </Transition>
        </div>

        <!-- Dashboard -->
        <NButton
          class="select-none"
          secondary
          :disabled="!currentConnectionPath"
          @click="() => {
            ipcRenderer.invoke('shell:openExternal', dashboardUrl)
          }"
        >
          {{ $t('goToDashboard') }}
        </NButton>

        <!-- Actions Overlay -->
        <Transition
          enter-from-class="opacity-0"
          enter-active-class="transition-opacity duration-700"
          enter-to-class="opacity-100"
          leave-from-class="opacity-100"
          leave-active-class="transition-opacity duration-700"
          leave-to-class="opacity-0"
        >
          <div
            v-if="
              !currentConnectionPath
                || (currentConnectionPath && (!authentication || !device?.initialized))
            "
            class="absolute inset-0 flex items-center justify-center gap-1 backdrop-blur-sm -m-2"
          >
            <!-- Connecting -->
            <div v-if="!currentConnectionPath" class="flex items-center gap-1">
              <!-- <i class="i-svg-spinners:bars-rotate-fade size-4" /> -->
              <span class="text-2xl">{{ $t('connecting') }}</span>
              <i class="i-svg-spinners:3-dots-fade size-8" />
            </div>
            <!-- Authentication & Initialization -->
            <NButton
              v-if="currentConnectionPath && (!authentication || !device.initialized)"
              class="select-none"
              strong
              type="primary"
              @click="() => {
                if (!authentication && device?.initialized) {
                  ipcRenderer.invoke('deviceWindow:show', 'Login')
                }
                else {
                  ipcRenderer.invoke('shell:openExternal', dashboardUrl)
                }
              }"
            >
              {{
                !device.initialized
                  ? $t('startUsingDevice', { device: device.device_model ?? device.device_name })
                  : !authentication
                    ? $t('login')
                    : ''
              }}
            </NButton>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Explore -->
    <Transition
      enter-from-class="max-h-0 opacity-0 -mt-3"
      enter-active-class="transition-[max-height,opacity,colors,margin] duration-700"
      enter-to-class="max-h-40 opacity-100 mt-0"
      leave-from-class="max-h-40 opacity-100 mt-0"
      leave-active-class="transition-[max-height,opacity,colors,margin] duration-700"
      leave-to-class="max-h-0 opacity-0 -mt-3"
    >
      <Explore
        v-if="currentConnectionPath && device && device.initialized && authentication "
        :user="user"
        :current-connection-path="currentConnectionPath"
      />
    </Transition>
  </div>
</template>
