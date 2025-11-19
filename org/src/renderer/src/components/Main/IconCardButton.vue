<script setup lang="ts">
defineProps<{
  name?: string
  iconClass?: any
}>()
</script>

<template>
  <button
    class="group/icb relative h-24 cursor-pointer appearance-none justify-between overflow-hidden border border-[#333]/13 rounded-xl bg-surface-0 p-3 transition-[colors,shadow] duration-300 dark:border-[#FFF]/13 dark:bg-surface-950 focus-visible:bg-surface-100 hover:bg-surface-100 active:shadow-none focus-visible:shadow-md hover:shadow-md focus-visible:outline-0 dark:focus-visible:bg-surface-900 dark:hover:bg-surface-900"
    v-bind="$attrs"
  >
    <div v-if="$slots.default" class="absolute inset-0 size-full">
      <slot />
    </div>
    <div class="relative h-full w-full flex flex-col items-start justify-between">
      <div class="flex items-center justify-between text-xs text-surface-400 dark:text-surface-600">
        <div class="size-8 flex items-center justify-center border border-black/5 rounded-lg bg-surface-100 dark:border-white/5 dark:bg-surface-800">
          <i class="flex text-5 text-surface-700 dark:text-surface-300" :class="iconClass" />
        </div>
      </div>
      <span class="text-left text-lg text-surface-900 leading-none dark:text-surface-100">
        {{ name }}
      </span>
    </div>
  </button>
</template>
