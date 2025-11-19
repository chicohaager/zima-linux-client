<script setup lang="ts">
import type { ButtonProps } from 'naive-ui'
import { NButton } from 'naive-ui'

interface CopyButtonProps {
  copy: string
  text?: ButtonProps['text']
  size?: ButtonProps['size']
}

const props = defineProps<CopyButtonProps>()

const timer = ref<any>()
const copied = ref(false)
function copyToClipboard() {
  navigator.clipboard.writeText(props.copy)
  copied.value = true
  timer.value && clearTimeout(timer.value)
  timer.value = setTimeout(() => {
    copied.value = false
    clearTimeout(timer.value)
  }, 3000)
}
</script>

<template>
  <NButton
    :text="props.text === false ? false : true"
    :size="props.size"
    @click="copyToClipboard"
  >
    <template #icon>
      <span class="flex items-center justify-center">
        <i
          :class="[copied ? 'i-bx:check' : 'i-bx:copy-alt']"
        />
      </span>
    </template>
  </NButton>
</template>
