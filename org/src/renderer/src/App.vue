<script setup lang="ts">
import { usePreferredDark } from '@vueuse/core'
import { darkTheme, NConfigProvider, NMessageProvider } from 'naive-ui'
import { ZexNaiveDarkThemeOverrides, ZexNaiveThemeOverrides } from 'zexui/naiveui/themeOverrides'

const isDark = usePreferredDark()
watchEffect(() => {
  document.documentElement.classList.toggle('dark', isDark.value)
})
</script>

<template>
  <NConfigProvider
    :theme="isDark ? darkTheme : undefined"
    :theme-overrides="{
      ...(isDark ? ZexNaiveDarkThemeOverrides : ZexNaiveThemeOverrides),
    }"
  >
    <NMessageProvider>
      <RouterView />
    </NMessageProvider>
  </NConfigProvider>
</template>
