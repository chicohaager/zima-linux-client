<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import ZimaCube from '/images/model/zimacube.png'
import ZimaCubePro from '/images/model/zimacube_pro.png'

const props = defineProps<{
  device: DeviceInfo
}>()

const modelImg = computed(() => {
  switch (props.device.device_model) {
    case 'ZimaCube':
      return ZimaCube
    case 'ZimaCube Pro':
      return ZimaCubePro
    default:
      return undefined
  }
})
</script>

<template>
  <img
    v-if="modelImg"
    class="[-webkit-user-drag:none] select-none"
    :src="modelImg"
    :alt="props.device.device_model"
  >
</template>
