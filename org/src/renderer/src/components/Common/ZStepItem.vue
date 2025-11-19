<script lang="ts" setup>
defineProps({
  finished: {
    type: Boolean,
    required: true,
  },
  showBorder: {
    type: Boolean,
    default: true,
  },
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <div class="size-8 flex items-center justify-center">
        <i v-if="finished" class="i-iw:success size-6 text-green-500" />
        <span v-else class="size-5 border-3 border-green-500 rounded-full" />
      </div>
      <slot name="title" />
    </div>
    <div class="flex gap-2">
      <div class="w-8 flex justify-center">
        <div v-if="showBorder" class="border-x-1" :class="{ 'border-green-500': finished }" />
      </div>
      <slot />
    </div>
  </div>
</template>
