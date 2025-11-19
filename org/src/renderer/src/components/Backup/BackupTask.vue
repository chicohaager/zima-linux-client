<script setup lang="ts">
import { NButton, NCheckbox, NTooltip, useDialog } from 'naive-ui'
import neoBytes from 'neo-bytes'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  task: ZimaBackupTask
}>()

const showExtra = defineModel<boolean>(
  'showExtra',
  {
    default: false,
  },
)

const dialog = useDialog()

const ipcRenderer = window.electron.ipcRenderer

const { t } = useI18n()

const status = computed(() => {
  switch (props.task.status) {
    case 'in_progress':
      return t('backup.status.inProgress')
    case 'paused':
      return t('backup.status.paused')
    case 'complete':
      return t('backup.status.completed')
    case 'error':
      return t('backup.status.error')
    default:
      return t('backup.status.unknown')
  }
})

function handleStop() {
  dialog.error({
    title: t('backup.stopBackupTask'),
    content: t('backup.stopBackupTaskDescription'),
    autoFocus: false,
    closable: false,
    positiveText: t('stop'),
    onPositiveClick: () => {
      ipcRenderer.invoke('ZimaBackup:deleteBackup', props.task.task_id)
    },
    negativeText: t('cancel'),
  })
}
</script>

<template>
  <div class="w-full flex flex-col gap-4 border border-surface-200 rounded-xl bg-surface-0 p-4 dark:border-surface-800 dark:bg-black">
    <!-- Header -->
    <div
      class="h-fit flex flex-row cursor-pointer items-center justify-between"
      @click="showExtra = !showExtra"
    >
      <div class="flex flex-row items-center gap-4">
        <div class="size-12 flex items-center justify-center border border-#333/5 rounded-xl bg-surface-100 dark:bg-surface-900">
          <i
            class="size-6"
            :class="{
              'i-iw:backup text-primary-500': props.task.status === 'in_progress',
              'i-bx:pause-circle': props.task.status === 'paused',
              'i-bx:check-circle text-green-500': props.task.status === 'complete',
              'i-bx:error-alt text-amber-500': props.task.status === 'error',
            }"
          />
        </div>
        <div class="h-12 flex flex-col justify-between">
          <span class="text-base font-semibold">
            {{ props.task.name ?? props.task.source_path.split(/[\\\/]/).pop() }}
          </span>
          <div class="flex flex-row items-center gap-1">
            <LeoTag>
              <span
                :class="{
                  'text-green-500': props.task.status === 'complete',
                  'text-amber-500': props.task.status === 'error',
                }"
              >
                {{ status }}
              </span>
            </LeoTag>
            <LeoTag v-if="props.task.status === 'in_progress' && props.task.speed">
              {{ neoBytes(props.task.speed, { suffix: '/s' }) }}
            </LeoTag>
          </div>
        </div>
      </div>
      <div class="h-full flex items-center justify-center">
        <div
          class="size-8 flex items-center justify-center transition-transform duration-300"
          :class="[
            showExtra ? '-transform-rotate-180' : 'transform-rotate-0',
          ]"
        >
          <i class="i-iw:up size-5" />
        </div>
      </div>
    </div>
    <!-- Extra -->
    <Transition
      enter-from-class="max-h-0 opacity-0 -mt-4"
      enter-active-class="transition-[max-height,opacity,margin] duration-500 overflow-hidden"
      enter-to-class="max-h-37 opacity-100 mt-0"
      leave-from-class="max-h-37 opacity-100 mt-0"
      leave-active-class="transition-[max-height,opacity,margin] duration-500 overflow-hidden"
      leave-to-class="max-h-0 opacity-0 -mt-4"
    >
      <div v-show="showExtra" class="flex flex-col gap-4">
        <div class="grid grid-cols-2 gap-2 rounded-lg *:bg-surface-50 *:dark:bg-surface-900">
          <!-- From -->
          <div class="grid grid-rows-2 border border-#333/5 rounded-lg divide-y divide-#333/5 dark:border-white/5 *:p-3 dark:divide-white/5">
            <div class="flex flex-row items-center justify-between">
              <div class="flex gap-1 text-base">
                <span class="font-semibold">
                  {{ $t('backup.from') }}
                </span>
                <span class="text-surface-400 dark:text-surface-600">
                  {{ $t('backup.local') }}
                </span>
              </div>
              <div class="flex flex-row items-center gap-1">
                <LeoTag>
                  {{ neoBytes(props.task.total_size) }}
                </LeoTag>
                <LeoTag>
                  {{ $t('nFiles', { n: props.task.total_files }) }}
                </LeoTag>
              </div>
            </div>
            <div class="flex items-center text-sm">
              <span
                class="line-clamp-1 cursor-pointer break-all hover:underline"
                :title="props.task.source_path"
                @click="ipcRenderer.invoke('shell:showItemInFolder', props.task.source_path)"
              >
                {{ props.task.source_path }}
              </span>
            </div>
          </div>
          <!-- To -->
          <div class="grid grid-rows-2 border border-#333/5 rounded-lg divide-y divide-#333/5 dark:border-white/5 *:p-3 dark:divide-white/5">
            <div class="flex flex-row items-center justify-between">
              <div class="flex gap-1 text-base">
                <span class="font-semibold">
                  {{ $t('backup.to') }}
                </span>
                <span class="text-surface-400 dark:text-surface-600">
                  Zima
                </span>
              </div>
              <div class="flex flex-row items-center gap-1">
                <LeoTag>
                  {{ neoBytes(props.task.xferred_size) }}
                </LeoTag>
                <LeoTag>
                  {{ $t('nFiles', { n: props.task.xferred_files }) }}
                </LeoTag>
              </div>
            </div>
            <div class="flex items-center text-sm">
              <span
                class="line-clamp-1 cursor-pointer break-all hover:underline"
                :title="props.task.dest_path"
                @click="ipcRenderer.invoke('zimaos:files:openPath', props.task.dest_path)"
              >
                {{ props.task.dest_path }}
              </span>
            </div>
          </div>
        </div>
        <div class="flex flex-row items-center justify-between">
          <!-- Left -->
          <div class="flex flex-row items-center">
            <NCheckbox
              :checked="props.task.keep_revision"
              @update:checked="ipcRenderer.invoke('ZimaBackup:keepRevision', props.task.task_id, !props.task.keep_revision)"
            >
              {{ $t('backup.retainFileVersion') }}
            </NCheckbox>
            <NTooltip
              trigger="hover"
              class="w-100"
            >
              <template #trigger>
                <i class="i-bx:help-circle size-4 cursor-pointer text-surface-400 dark:text-surface-600" />
              </template>
              <span>
                {{ $t('backup.retainFileVersionDescription') }}
              </span>
            </NTooltip>
          </div>
          <!-- Right -->
          <div class="flex flex-row items-center gap-2">
            <NButton
              quaternary
              type="error"
              @click="handleStop()"
            >
              {{ $t('stop') }}
            </NButton>
            <NButton
              secondary
              @click="
                props.task.status !== 'paused'
                  ? ipcRenderer.invoke('ZimaBackup:pasueBackup', props.task.task_id)
                  : ipcRenderer.invoke('ZimaBackup:resumeBackup', props.task.task_id)"
            >
              {{
                props.task.status !== 'paused'
                  ? $t('pause')
                  : $t('resume')
              }}
            </NButton>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
