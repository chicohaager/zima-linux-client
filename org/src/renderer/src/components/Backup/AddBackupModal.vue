<script setup lang="ts">
import { NButton, NCard, NModal } from 'naive-ui'

const ipcRenderer = window.electron.ipcRenderer

const show = defineModel<boolean>('show', {
  default: false,
})

const localPath = ref<string>('')
const defaultZimaPath = '/media/ZimaOS-HD/Backup'
const zimaPath = ref<string>(defaultZimaPath)
const zimaPathValid = ref<boolean>(false)

const creatingBackup = ref(false)

function createBackup() {
  creatingBackup.value = true

  function handleCreatedEvent(_, message: ZimaBackupStatusChangeMessage) {
    if (message.status === 'created') {
      // Wait for the list event to be fired for the new task
      ipcRenderer.once(
        'ZimaBackup:events:list',
        () => {
          creatingBackup.value = false
          show.value = false
        },
      )
    }
    else {
      // Wait for the next status change event
      ipcRenderer.once(
        'ZimaBackup:events:status_change',
        handleCreatedEvent,
      )
    }
  }
  ipcRenderer.once(
    'ZimaBackup:events:status_change',
    handleCreatedEvent,
  )

  ipcRenderer.invoke(
    'ZimaBackup:createBackup',
    localPath.value,
    zimaPath.value,
  )
}

watch(
  () => show.value,
  (value) => {
    if (value) {
      localPath.value = ''
      zimaPath.value = defaultZimaPath
      zimaPathValid.value = false
    }
  },
)
</script>

<template>
  <NModal
    v-model:show="show"
    :auto-focus="false"
    :close-on-esc="false"
    :mask-closable="false"
  >
    <NCard
      class="app-no-drag w-140 bg-surface-100 dark:bg-surface-900"
      :title="$t('backup.addBackupFolder')"
    >
      <template #header-extra>
        <NButton
          quaternary
          class="size-8"
          :disabled="creatingBackup"
          @click="show = false"
        >
          <template #icon>
            <i
              class="i-iw:close size-5"
            />
          </template>
        </NButton>
      </template>

      <div class="flex flex-col gap-4">
        <ZStepItem :finished="!!localPath" show-border>
          <template #title>
            <div v-if="!!localPath" class="text-2xl">
              <span class="font-semibold">
                {{ $t('backup.from') }}
              </span>
              <span class="text-surface-400 dark:text-surface-600">
                {{ $t("backup.local") }}
              </span>
            </div>
            <div v-else class="text-2xl">
              {{ $t('selectFolder') }}
            </div>
          </template>
          <SelectFolder
            v-model:folder="localPath"
            select-on-mounted
            :disabled="creatingBackup"
          />
        </ZStepItem>
        <ZStepItem :finished="zimaPathValid" :show-border="false">
          <template #title>
            <div class="text-2xl">
              <span class="font-semibold">
                {{ $t('backup.to') }}
              </span>
              <span class="text-surface-400 dark:text-surface-600">
                Zima
              </span>
            </div>
          </template>
          <ZimaDevicePath
            v-model:path="zimaPath"
            v-model:vaild="zimaPathValid"
            :disabled="creatingBackup"
          />
        </ZStepItem>
      </div>

      <template #footer>
        <div class="flex items-center justify-end">
          <NButton
            type="primary"
            :disabled="!localPath || !zimaPathValid"
            :loading="creatingBackup"
            @click="createBackup()"
          >
            {{ $t('start') }}
          </NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>
