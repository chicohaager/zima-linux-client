<script setup lang="ts">
import type { TooltipProps } from 'naive-ui'
import { Connection } from '@renderer/utils/connection'
import { NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = withDefaults (defineProps<{
  method: ConnectionMethod
  current?: ConnectionPath
  paths: ConnectionPath[]
  tooltipPlacement?: TooltipProps['placement']
  showTooltip?: boolean
  showPathsIp?: boolean
  showConnected?: boolean
  sizeClass?: string
}>(), {
  tooltipPlacement: 'bottom',
  showTooltip: true,
  showPathsIp: true,
  showConnected: false,
})

const { t } = useI18n()

const selectedPaths = computed(() => props.paths.filter(path => path.method === props.method))
const selectedPathsStatusText = computed(() => {
  switch (props.method) {
    case 'thunderbolt':
      return selectedPaths.value.length > 0
        ? (props.showConnected && props.current?.method === props.method)
            ? t('connectedViaThunderbolt')
            : t('thunderboltAvailable')
        : t('thunderboltUnavailable')
    case 'ethernet':
      return selectedPaths.value.length > 0
        ? (props.showConnected && props.current?.method === props.method)
            ? t('connectedViaEthernet')
            : t('ethernetAvailable')
        : t('ethernetUnavailable')
    case 'wifi':
      return selectedPaths.value.length > 0
        ? (props.showConnected && props.current?.method === props.method)
            ? t('connectedViaWifi')
            : t('wifiAvailable')
        : t('wifiUnavailable')
    case 'remote':
      return selectedPaths.value.length > 0
        ? (props.showConnected && props.current?.method === props.method)
            ? t('connectedViaRemote')
            : t('remoteAvailable')
        : t('remoteUnavailable')
    default:
      return ''
  }
})
const connectedViaSelected = computed(() => {
  if (!props.current || !props.showConnected) {
    return false
  }
  else {
    return props.current.method === props.method
  }
})
</script>

<template>
  <NTooltip
    trigger="hover"
    :placement="tooltipPlacement"
    :disabled="!showTooltip"
  >
    <template #trigger>
      <span
        class="flex items-center justify-center"
        :class="[
          ...($attrs.class as any),
          showConnected && connectedViaSelected
            ? 'p-1 bg-surface-0 dark:bg-surface-950 rounded-md drop-shadow-sm border border-#333/13 dark:border-#fff/13'
            : '',
          showConnected
            ? 'h-26px'
            : '',
        ]"
      >
        <i
          :class="[
            sizeClass ? sizeClass : 'size-4',
            Connection.IconClass(props.method),
            selectedPaths.length > 0
              ? connectedViaSelected
                ? 'text-green-500'
                : ''
              : 'text-surface-300 dark:text-surface-600',
          ]"
        />
      </span>
    </template>
    <div class="flex flex-col gap-1">
      <span class="select-none">
        {{ selectedPathsStatusText }}
      </span>
      <div v-if="selectedPaths.length > 0 && showPathsIp" class="flex flex-col gap-1">
        <div v-for="(path, _) in selectedPaths" :key="_" class="group/ip flex items-center gap-1">
          <span class="select-all text-xs font-mono">{{ path.remote_ipv4 }}</span>
          <CopyButton
            size="tiny"
            :copy="path.remote_ipv4"
            class="text-surface-0 opacity-0 dark:text-surface-100 group-hover/ip:opacity-70 hover:text-primary-300! dark:hover:text-primary-400!"
          />
        </div>
      </div>
    </div>
  </NTooltip>
</template>
