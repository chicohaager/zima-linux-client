<script setup lang="ts">
defineProps<{
  paths: ConnectionPath[]
  current?: ConnectionPath
  showConnected?: boolean
  sizeClass?: string
  indicatorClass?: string
}>()
</script>

<template>
  <div class="flex items-center gap-3">
    <ConnectionPathIndicator
      method="remote"
      :paths="paths"
      :current="current"
      :show-connected="showConnected"
      :size-class="sizeClass"
      :class="indicatorClass"
    />
    <ConnectionPathIndicator
      method="wifi"
      :paths="paths"
      :current="current"
      :show-connected="showConnected"
      :size-class="sizeClass"
      :class="indicatorClass"
    />
    <ConnectionPathIndicator
      method="ethernet"
      :paths="paths"
      :current="current"
      :show-connected="showConnected"
      :size-class="sizeClass"
      :class="indicatorClass"
    />
    <ConnectionPathIndicator
      method="thunderbolt"
      :paths="paths"
      :current="current"
      :show-connected="showConnected"
      :size-class="sizeClass"
      :class="indicatorClass"
    />
  </div>
</template>
