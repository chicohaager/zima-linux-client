<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const ipcRenderer = window.electron.ipcRenderer
const { t } = useI18n()

const tasks = ref<ZimaBackupTask[]>([])
const backupStatus = computed<ZimaBackupTaskStatus | null>(() => {
  // If there are no tasks, the backup status is null
  if (tasks.value.length === 0) {
    return null
  }
  // If any task is in error state, the backup status is error
  else if (tasks.value.some(task => task.status === 'error')) {
    return 'error'
  }
  // If any task is in progress, the backup status is in progress
  else if (tasks.value.some(task => task.status === 'in_progress')) {
    return 'in_progress'
  }
  // If all tasks are paused, the backup status is paused
  else if (tasks.value.every(task => task.status === 'paused')) {
    return 'paused'
  }
  // If all tasks are completed, the backup status is completed
  else if (tasks.value.every(task => task.status === 'complete')) {
    return 'complete'
  }
  return null
})

const backupIconClass = computed(() => {
  switch (backupStatus.value) {
    case 'in_progress':
      return 'i-iw:backup text-primary-500! dark:text-primary-400!' // animate-spin animate-reverse
    case 'paused':
      return 'i-bx:pause-circle'
    case 'complete':
      return 'i-bx:check-circle text-green-500! dark:text-green-400!'
    case 'error':
      return 'i-bx:error-alt text-amber-500! dark:text-amber-400!'
    default:
      return 'i-iw:backup'
  }
})

const backupStatusName = computed(() => {
  switch (backupStatus.value) {
    case 'in_progress':
      ipcRenderer.invoke('Tray:updateIcon', 'transfer')
      return t('backup.backupStatus.inProgress')
    case 'paused':
      ipcRenderer.invoke('Tray:updateIcon', 'paused')
      return t('backup.backupStatus.paused')
    case 'error':
      ipcRenderer.invoke('Tray:updateIcon', 'error')
      return t('backup.backupStatus.error')
    case 'complete':
      ipcRenderer.invoke('Tray:updateIcon', 'zima')
      return t('backup.backupStatus.completed')
    default:
      ipcRenderer.invoke('Tray:updateIcon', 'zima')
      return t('backup.name')
  }
})

const createdTask = ref<ZimaBackupTask['task_id'] | null>(null)

onMounted(() => {
  ipcRenderer.on(
    'ZimaBackup:events:list',
    (_, message: ZimaBackupListMessage) => {
      tasks.value = message.tasks

      if (createdTask.value) {
        const task = tasks.value.find(task => task.task_id === createdTask.value)
        if (task) {
          ipcRenderer.invoke('notification:show', {
            title: t('backup.name'),
            body: t('backup.taskCreated', { task: task.name }),
          })
          createdTask.value = null
        }
      }
    },
  )

  ipcRenderer.on(
    'ZimaBackup:events:status_change',
    (_, message: ZimaBackupStatusChangeMessage) => {
      const task_id = message.task_id
      const task = tasks.value.find(task => task.task_id === task_id)

      if (task){
      switch (message.status) {
        case 'created':
          createdTask.value = task_id
          break
        case 'deleted':
          ipcRenderer.invoke('notification:show', {
            title: t('backup.name'),
            body: t('backup.taskStopped', { task: task.name }),
          })
          break
        case 'complete':
          ipcRenderer.invoke('notification:show', {
            title: t('backup.name'),
            body: t('backup.taskCompleted', { task: task.name }),
          })
          break
      }}

      ipcRenderer.invoke('ZimaBackup:listBackups')
    },
  )

  ipcRenderer.invoke('ZimaBackup:listBackups')
})
</script>

<template>
  <IconCardButton
    :name="backupStatusName"
    class="col-span-2"
    :icon-class="backupIconClass"
    @click="ipcRenderer.invoke('ZimaBackupWindow:show')"
  >
    <template v-if="!backupStatus" #default>
      <div class="h-full w-full flex items-center justify-end">
        <div class="w-1/2 flex items-center gap-1 text-surface-400 dark:text-surface-600">
          <i class="i-iw:add size-4" />
          <span class="text-sm">{{ $t('backup.addBackupFolder') }}</span>
        </div>
      </div>
    </template>
  </IconCardButton>
</template>
