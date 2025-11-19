<script setup lang="ts">
import { useZeroTierService } from '@renderer/store'
import log from 'electron-log'
import { NButton, NTooltip } from 'naive-ui'

const zts = useZeroTierService()

const installBtnShaking = ref(false)
const startBtnShaking = ref(false)

onMounted(() => {
  !zts.monitoring && zts.startMonitor()

  watch(
    () => zts.installed,
    (value, prev) => {
      if (prev === undefined && value) {
        log.info(`ZeroTier ${value ? `${value} Installed` : 'Not Installed'}`)
      }
      else if (prev !== value) {
        log.info(`ZeroTier ${value ? `${value} Installed` : 'Uninstalled'}`)
      }
    },
    { immediate: true },
  )

  watch(
    () => zts.running,
    (value, prev) => {
      if (prev === undefined && value) {
        log.info(`ZeroTier Service ${value ? 'Running' : 'Not Running'}`)
      }
      else if (prev !== value) {
        log.info(`ZeroTier Service ${value ? 'Started' : 'Stopped'}`)
      }
    },
    { immediate: true },
  )
})
</script>

<template>
  <div class="size-full flex flex-col items-center justify-center gap-6">
    <div class="flex flex-col items-center gap-1">
      <span class="text-3xl">ZeroTier</span>
      <span
        class="text-sm"
        :class="[
          zts.installed === undefined
            ? 'i-svg-spinners:3-dots-fade flex'
            : zts.installed
              ? 'text-green'
              : '',
        ]"
      >
        {{ zts.installed ? zts.installed : 'Not Installed' }}
      </span>
      <span
        v-if="zts.installed"
        class="text-sm"
        :class="[
          zts.running === undefined
            ? 'i-svg-spinners:3-dots-fade flex'
            : zts.running
              ? 'text-green'
              : '',
        ]"
      >
        {{ zts.running ? 'Running' : 'Not Running' }}
      </span>
    </div>
    <div class="flex flex-col items-center gap-2">
      <NButton
        v-if="zts.needUpdate"
        :disabled="zts.installing || zts.uninstalling || zts.starting || zts.stopping"
        :loading="zts.installing"
        secondary
        @click="zts.install()"
      >
        {{ zts.installing ? 'Updating' : 'Update' }}
      </NButton>
      <NButton
        v-if="zts.installed !== undefined"
        :disabled="zts.installing || zts.uninstalling || zts.starting || zts.stopping"
        :loading="zts.installing || zts.uninstalling"
        class="w-fit"
        :class="{ 'animate-head-shake': installBtnShaking }"
        secondary
        @click="
          zts.installed
            ? zts.uninstall({
              catch: () => {
                installBtnShaking = true
              },
            })
            : zts.install({
              catch: () => {
                installBtnShaking = true
              },
            })
        "
        @animationend="installBtnShaking = false"
      >
        {{
          zts.installing
            ? 'Installing'
            : zts.uninstalling
              ? 'Uninstalling'
              : zts.installed
                ? 'Uninstall'
                : 'Install'
        }}
      </NButton>
      <NButton
        v-if="zts.installed && !zts.installing"
        :disabled="zts.starting || zts.stopping || zts.uninstalling"
        :loading="zts.starting || zts.stopping"
        class="w-fit"
        :class="{ 'animate-head-shake': startBtnShaking }"
        secondary
        @click="
          zts.running
            ? zts.stop({
              catch: () => {
                startBtnShaking = true
              },
            })
            : zts.start({
              catch: () => {
                startBtnShaking = true
              },
            })
        "
        @animationend="startBtnShaking = false"
      >
        {{
          zts.starting
            ? 'Starting'
            : zts.stopping
              ? 'Stopping'
              : zts.running
                ? 'Stop'
                : 'Start'
        }}
      </NButton>
    </div>
    <div v-if="zts.installed" class="flex flex-col items-center gap-2 pt-6">
      <span class="text-sm text-surface-500">{{ zts.authtoken ?? '👇🏻' }}</span>
      <NTooltip
        placement="bottom"
      >
        <template #trigger>
          <NButton
            :disabled="zts.gettingAuthToken || zts.initializingAuthToken || zts.uninstalling"
            size="tiny"
            secondary
            @click="
              zts.cantGetAuthToken
                ? zts.initAuthToken()
                : zts.getAuthToken()
            "
          >
            <i
              class="flex text-base"
              :class="[
                (zts.gettingAuthToken || zts.initializingAuthToken)
                  ? 'i-svg-spinners:180-ring'
                  : zts.cantGetAuthToken
                    ? 'i-bx:error text-red-500'
                    : 'i-bx:refresh',
              ]"
            />
          </NButton>
        </template>
        {{
          zts.gettingAuthToken
            ? 'Refreshing'
            : zts.initializingAuthToken
              ? 'Initializing'
              : zts.cantGetAuthToken
                ? 'Init AuthToken'
                : 'Refresh AuthToken'
        }}
      </NTooltip>
      <!-- <span>{{ $t('languageName') }}</span> -->
    </div>
  </div>
</template>
