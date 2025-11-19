<script setup lang="ts">
import EmptyFolderPng from '@renderer/assets/images/emptyFolder.png'
import { Connection } from '@renderer/utils/connection'
import { NButton, NDialogProvider, NModalProvider, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const ipcRenderer = window.electron.ipcRenderer
const { t } = useI18n()
const nMessage = useMessage()

const showAddBackupModal = ref(false)

const tasks = ref<ZimaBackupTask[]>([])

const recivedFirstTasks = ref(false)
const createdTask = ref<string | null>(null)

const currentConnectionPath = ref<ConnectionPath>()
function getCurrentConnectionPath() {
  Connection.getCurrentConnectionPath().then((path) => {
    currentConnectionPath.value = path
  })
}

function refreshTasks() {
  ipcRenderer.invoke('ZimaBackup:listBackups')
}

onMounted(() => {
  watch(
    recivedFirstTasks,
    (value) => {
      if (value && tasks.value.length === 0) {
        showAddBackupModal.value = true
      }
    },
  )

  setInterval(() => {
    getCurrentConnectionPath()
  }, 1000)
  getCurrentConnectionPath()

  ipcRenderer.on(
    'ZimaBackup:events:list',
    (_, message: ZimaBackupListMessage) => {
      tasks.value = message.tasks

      if (createdTask.value) {
        const task = tasks.value.find(task => task.task_id === createdTask.value)
        if (task) {
          nMessage.success(t('backup.taskCreated', { task: task.name }))
        }
        createdTask.value = null
      }

      if (!recivedFirstTasks.value) {
        recivedFirstTasks.value = true
      }
    },
  )

  ipcRenderer.on(
    'ZimaBackup:events:keep_revision_change',
    (_, message: ZimaBackupKeepRevisionChangeMessage) => {
      const task_id = message.task_id
      const task = tasks.value.find(task => task.task_id === task_id)
      if (task) {
        task.keep_revision = message.action
      }
    },
  )

  ipcRenderer.on(
    'ZimaBackup:events:progress',
    (_, message: ZimaBackupProgressMessage) => {
      const task_id = message.task_id
      const task = tasks.value.find(task => task.task_id === task_id)

      if (task) {
        task.total_files = message.total_files
        task.total_size = message.total_size
        task.xferred_files = message.xferred_files
        task.xferred_size = message.xferred_size
        task.speed = message.speed
      }
    },
  )

  ipcRenderer.on(
    'ZimaBackup:events:complete',
    (_, message: ZimaBackupCompleteMessage) => {
      const task_id = message.task_id
      const task = tasks.value.find(task => task.task_id === task_id)

      if (task) {
        task.total_files = message.total_files
        task.total_size = message.total_size
        task.xferred_files = message.xferred_files
        task.xferred_size = message.xferred_size
        task.speed = 0

        nMessage.success(t('backup.taskCompleted', { task: task.name }))
      }
    },
  )

  ipcRenderer.on(
    'ZimaBackup:events:status_change',
    (_, message: ZimaBackupStatusChangeMessage) => {
      const task_id = message.task_id
      const task = tasks.value.find(task => task.task_id === task_id)

      if (task) {
        switch (message.status) {
          case 'created':
            createdTask.value = task_id
            break
          case 'deleted':
            nMessage.success(t('backup.taskStopped', { task: task.name }))
            break
          default:
            break
        }
      }

      refreshTasks()
    },
  )

  refreshTasks()
})
</script>

<template>
  <WindowControl :title="$t('backup.name')" hide-title />
  <NModalProvider>
    <NDialogProvider>
      <div class="relative h-vh w-vw flex flex-col gap-4 overflow-hidden bg-surface-100 p-4 dark:bg-surface-900">
        <div
          v-if="!currentConnectionPath"
          class="app-drag absolute inset-0 z-9999 flex items-center justify-center gap-2 backdrop-blur-md"
        >
          <span class="text-2xl">{{ $t('connecting') }}</span>
          <i class="i-svg-spinners:3-dots-fade size-8" />
        </div>
        <div class="app-drag w-full flex flex-row justify-between pt-14">
          <h1 class="select-none text-2xl">
            {{ $t('backup.name') }}
          </h1>
          <NButton
            type="primary"
            class="app-no-drag size-8"
            @click="showAddBackupModal = true"
          >
            <template #icon>
              <i class="i-iw:add" />
            </template>
          </NButton>
          <AddBackupModal v-model:show="showAddBackupModal" />
        </div>
        <div class="flex flex-col gap-2 overflow-auto px-4 -mx-4">
          <BackupTask
            v-for="task in tasks"
            :key="task.task_id"
            :task="task"
            :show-extra="tasks.length === 1"
          />
          <div
            v-if="tasks.length === 0"
            class="flex flex-col cursor-pointer items-center gap-4"
            @click="showAddBackupModal = true"
          >
            <img
              class="h-40 w-40"
              :src="EmptyFolderPng"
            >
            <span class="text-xl">
              {{ $t('backup.addFirstBackup') }}
            </span>
          </div>
        </div>
      </div>
    </NDialogProvider>
  </NModalProvider>
</template>
