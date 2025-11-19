<script setup lang="ts">
import { NNotificationProvider } from 'naive-ui'
import { RouterView } from 'vue-router'
</script>

<template>
  <NNotificationProvider placement="top" container-class="mt-8">
    <div class="app-drag h-vh w-vw p-10 *:*:app-no-drag">
      <RouterView />
    </div>
  </NNotificationProvider>
</template>
