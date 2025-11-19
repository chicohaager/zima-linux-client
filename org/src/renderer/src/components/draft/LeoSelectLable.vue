<script setup lang="ts">
defineProps<{
  light?: boolean
  selected?: boolean
  text: string
}>()
</script>

<template>
  <div
    class="flex items-center gap-1 rounded-lg p-1" :class="[
      selected
        ? ' bg-surface-0 dark:bg-surface-950 border border-surface-100 dark:border-surface-900'
        : '',
    ]"
  >
    <i class="i-iw:selected size-4 flex" :class="light ? 'text-green-500' : 'text-surface-400 dark:text-surface-600'" />
    <span
      class="text-xs"
      :class="selected ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 dark:text-surface-600'"
    >{{ text }}</span>
  </div>
</template>
