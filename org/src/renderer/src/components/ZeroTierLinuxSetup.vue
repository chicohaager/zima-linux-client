<script setup lang="ts">
import { NButton, NModal } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  show: boolean
  command: string
}>()

const emit = defineEmits<{
  retry: []
  skip: []
}>()

const { t } = useI18n()

function copyCommand() {
  navigator.clipboard.writeText(props.command)
    .then(() => {
      // Could show a toast notification here
      console.log('Command copied to clipboard')
    })
    .catch((err) => {
      console.error('Failed to copy command:', err)
    })
}

function openTerminal() {
  // Try to open terminal - this varies by desktop environment
  window.electron.ipcRenderer.invoke('shell:openExternal', 'x-terminal-emulator')
    .catch(() => {
      // Fallback for different DEs
      window.electron.ipcRenderer.invoke('shell:openExternal', 'gnome-terminal')
        .catch(() => {
          window.electron.ipcRenderer.invoke('shell:openExternal', 'konsole')
            .catch(console.error)
        })
    })
}
</script>

<template>
  <NModal
    :show="show"
    :closable="false"
    :auto-focus="false"
    class="app-no-drag max-w-2xl"
    transform-origin="center"
    preset="card"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <i class="i-iw:terminal size-6 text-blue-500" />
        <span class="text-lg font-medium">{{ t('zerotierSetupRequired') }}</span>
      </div>
    </template>

    <div class="space-y-4">
      <p class="text-surface-700 dark:text-surface-300">
        {{ t('zerotierSetupDescription') }}
      </p>

      <div class="rounded-lg bg-surface-100 p-4 dark:bg-surface-800">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-surface-500 dark:text-surface-400">
            {{ t('runThisCommand') }}
          </span>
          <NButton
            size="tiny"
            secondary
            @click="copyCommand"
          >
            <div class="flex items-center gap-1">
              <i class="i-iw:copy size-3" />
              <span class="text-xs">{{ t('copy') }}</span>
            </div>
          </NButton>
        </div>
        <code class="block overflow-x-auto rounded bg-surface-900 p-3 font-mono text-xs text-green-400 dark:bg-surface-950">
          {{ command }}
        </code>
      </div>

      <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
        <div class="flex gap-2">
          <i class="i-iw:info-circle mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div class="text-sm text-blue-800 dark:text-blue-200">
            <p class="font-medium">{{ t('oneTimeSetup') }}</p>
            <p class="mt-1 text-xs opacity-90">
              {{ t('zerotierCapabilitiesExplanation') }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <NButton
          secondary
          @click="emit('skip')"
        >
          {{ t('skipForNow') }}
        </NButton>
        <div class="flex gap-2">
          <NButton
            @click="openTerminal"
          >
            <div class="flex items-center gap-1">
              <i class="i-iw:terminal size-4" />
              {{ t('openTerminal') }}
            </div>
          </NButton>
          <NButton
            type="primary"
            @click="emit('retry')"
          >
            <div class="flex items-center gap-1">
              <i class="i-iw:refresh size-4" />
              {{ t('checkAgain') }}
            </div>
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>
