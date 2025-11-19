<script setup lang="ts">
import { Connection } from '@renderer/utils/connection'
import { NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ path?: ConnectionPath }>()
const { t } = useI18n()

const connectedVia = computed(() => {
  switch (props.path?.method) {
    case 'thunderbolt':
      return t('connectedViaThunderbolt')
    case 'ethernet':
      return t('connectedViaEthernet')
    case 'wifi':
      return t('connectedViaWifi')
    case 'remote':
      return t('connectedViaRemote')
    default:
      return ''
  }
})
</script>

<template>
  <div class="flex items-center gap-1">
    <NTooltip
      trigger="hover"
      class="select-none"
      :disabled="!connectedVia"
      :keep-alive-on-hover="false"
      placement="bottom"
    >
      <template #trigger>
        <i
          class="size-4"
          :class="path ? ['text-green-500', Connection.IconClass(path.method)] : 'i-svg-spinners:bars-rotate-fade'"
        />
      </template>
      {{ path ? connectedVia : '' }}
    </NTooltip>

    <div class="group/ip flex items-baseline gap-1">
      <span class="leading-4">{{ path ? path.remote_ipv4 : $t('connecting') }}</span>
      <CopyButton v-if="path" :copy="path.remote_ipv4" class="opacity-0 group-hover/ip:opacity-60" size="tiny" />
    </div>
  </div>
</template>
