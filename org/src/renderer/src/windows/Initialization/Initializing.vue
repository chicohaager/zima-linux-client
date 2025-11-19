<script setup lang="ts">
import ZeroTierLinuxSetup from '@renderer/components/ZeroTierLinuxSetup.vue'
import { useZeroTierService } from '@renderer/store'
import { openExternal } from '@renderer/utils/shell'
import log from 'electron-log'
import { NButton, NModal, NProgress } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  wasInitialized: boolean
}>()

const { t } = useI18n()
const ipcRenderer = window.electron.ipcRenderer
const zts = useZeroTierService()

const initialized = defineModel(
  'initialized',
  {
    required: true,
  },
)

const doingOperation = ref(false)
const userDeniedPermission = ref(false)
const showLinuxSetup = ref(false)

// Linux ZeroTier Capabilities Check
const needsLinuxSetup = computed(() => {
  return window.platform === 'linux'
    && zts.installed
    && !zts.needUpdate
    && zts.hasCapabilities === false
    && !doingOperation.value
    && !userDeniedPermission.value
})

// Handle Linux Setup Dialog
function handleLinuxSetupRetry() {
  log.info('Checking ZeroTier capabilities again...')
  zts.checkCapabilities({
    then: (hasCaps) => {
      if (hasCaps) {
        log.info('Capabilities detected, starting ZeroTier...')
        showLinuxSetup.value = false
        // Try to start the service
        InitForZeroTier()
      }
      else {
        log.warn('Capabilities still not set')
      }
    },
    catch: (err) => {
      log.error('Failed to check capabilities:', err)
    },
  })
}

function handleLinuxSetupSkip() {
  log.info('User skipped Linux setup')
  showLinuxSetup.value = false
  // Mark as completed to allow user to continue
  // They can set up capabilities later
}

/*
 * Initialization Stages
 */

// 1. AutoStart Stage
// TODO: Implement AutoStart Stage
const openAtLogin = ref(false)
const gotOpenAtLogin = ref(false)
const readyForAutoStartInit = computed(() => {
  return true
})
function InitForAutoStart() {
  ipcRenderer.invoke('app:setOpenAtLogin').then(() => {
    ipcRenderer.invoke('app:getOpenAtLogin').then((value) => {
      openAtLogin.value = value.openAtLogin
      if (!openAtLogin.value) {
        InitForAutoStart()
      }
    }).catch(log.error)
  }).catch(log.error)
}
const progressAutoStart = computed(() => {
  return props.wasInitialized || openAtLogin.value ? 100 : 0
})

// 2. ZeroTier Stage
const readyForZeroTierInit = computed(() => {
  return progressAutoStart.value === 100
    && zts.monitoring
    && zts.installed !== undefined
    && zts.running !== undefined
    && zts.authtoken !== undefined
})
function InitForZeroTier() {
  if (
    (zts.monitoring && !zts.installed) // Not Installed
    || (zts.monitoring && zts.installed && zts.needUpdate) // Need Update
  ) {
    log.info('Initialization: ZeroTier need to install or update.')

    if (doingOperation.value) {
      return
    }
    zts.install({
      start: () => {
        doingOperation.value = true
      },
      then: () => {
        // After installation on Linux, check capabilities
        if (window.platform === 'linux') {
          zts.checkCapabilities({
            then: () => {
              zts.getSetcapCommand() // Load the command for the dialog
              InitForZeroTier()
            },
          })
        }
        else {
          InitForZeroTier()
        }
      },
      catch: (err) => {
        log.error(err)

        if (err.toString().includes('User did not grant permission')) {
          userDeniedPermission.value = true
        }
      },
      finally: () => {
        doingOperation.value = false
      },
    })
  }
  else if (zts.monitoring && zts.installed && !zts.needUpdate && needsLinuxSetup.value) {
    // Linux: Need capabilities before starting
    log.info('Initialization: ZeroTier needs Linux capabilities setup.')
    showLinuxSetup.value = true
  }
  else if (zts.monitoring && zts.installed && !zts.needUpdate && !zts.running) {
    log.info('Initialization: ZeroTier service need to start.')

    if (doingOperation.value) {
      return
    }
    zts.start({
      start: () => {
        doingOperation.value = true
      },
      then: () => {
        InitForZeroTier()
      },
      catch: (err) => {
        log.error(err)
        if (err.toString().includes('User did not grant permission')) {
          userDeniedPermission.value = true
        }
      },
      finally: () => {
        doingOperation.value = false
      },
    })
  }
  else if (zts.monitoring && zts.installed && !zts.needUpdate && zts.running && !zts.authtoken) {
    log.info('Initialization: ZeroTier need to get authtoken.')
    zts.getAuthToken({
      start: () => {
        doingOperation.value = true
      },
      then: (res) => {
        if (res === null) {
          log.info('Initialization: ZeroTier need to init authtoken.')
          zts.initAuthToken({
            catch: (err) => {
              log.error(err)
              if (err.toString().includes('User did not grant permission')) {
                userDeniedPermission.value = true
              }
            },
            finally: () => {
              doingOperation.value = false
            },
          })
        }
        else {
          doingOperation.value = false
        }
      },
    })
  }
}
const progressZeroTier = computed(() => {
  return (readyForZeroTierInit.value ? 10 : 0)
    + (zts.installed || (zts.installed && !zts.needUpdate) ? 40 : 0)
    + (zts.running ? 30 : 0)
    + (zts.authtoken ? 20 : 0)
})

const progress = computed(() => {
  return (
    progressAutoStart.value === 100
    && progressZeroTier.value === 100
  )
    ? 100
    : Math.round(
        progressAutoStart.value * 0.1
        + progressZeroTier.value * 0.9,
      )
})

function initialization() {
  // Reverse order evaluation for stages
  if (readyForZeroTierInit.value) {
    InitForZeroTier()
  }
  else if (readyForAutoStartInit.value) {
    InitForAutoStart()
  }
}

onMounted(() => {
  window.document.title = t('initialization')

  // Get Open At Login
  ipcRenderer.invoke('app:getOpenAtLogin').then((value) => {
    openAtLogin.value = value.openAtLogin
    gotOpenAtLogin.value = true
  }).catch(log.error)

  // Start ZeroTier Service Monitor
  !zts.monitoring && zts.startMonitor()

  // Watch Stage
  const unwatchStage = watch(
    () => [
      userDeniedPermission.value,
      doingOperation.value,
      readyForAutoStartInit.value,
      readyForZeroTierInit.value,
    ],
    () => {
      if (doingOperation.value || userDeniedPermission.value) {
        return
      }
      initialization()
    },
    { immediate: true },
  )

  // Watch Progress
  const unwatchProgress = watch(
    () => progress.value,
    (value) => {
      if (value === 100) {
        unwatchStage()
        userDeniedPermission.value = false
        doingOperation.value = false

        unwatchProgress()
        setTimeout(() => {
          initialized.value = true
        }, 700)
      }
    },
  )

  initialization()
})
</script>

<template>
  <div class="app-drag h-vh w-vw flex flex-col justify-between bg-surface-0 p-10 dark:bg-surface-950">
    <span class="text-4xl text-surface-900 dark:text-surface-50">{{ $t('initializing') }}</span>
    <NProgress
      :percentage="progress"
      :show-indicator="false"
      :processing="userDeniedPermission ? false : true"
      :status="userDeniedPermission ? 'error' : 'info'"
      :border-radius="0"
      :height="4"
    />
    <div class="flex items-center justify-between">
      <NButton
        primary
        class="app-no-drag w-fit"
        size="small"
        @click="openExternal('https://docs.zimaspace.com/zimaos/How-to-download-and-install-ZimaClient.html')"
      >
        <div class="flex items-center gap-1 text-surface-400 dark:text-surface-500">
          <i class="i-iw:info-circle size-4" />
          <span class="text-xs">{{ $t('help') }}</span>
        </div>
      </NButton>
    </div>
    <NModal
      :show="userDeniedPermission"
      :closable="false"
      :auto-focus="false"
      class="app-no-drag"
      type="error"
      transform-origin="center"
      preset="dialog"
      :title="$t('permissionRequired')"
      :content="$t('permissionRequiredDescription')"
      :positive-text="$t('retry')"
      :negative-text="$t('quit')"
      @positive-click="() => {
        userDeniedPermission = false
        initialization()
      }"
      @negative-click="() => {
        ipcRenderer.invoke('window:setClosable', true)
        ipcRenderer.invoke('app:quit')
      }"
    />
    <ZeroTierLinuxSetup
      :show="showLinuxSetup"
      :command="zts.setcapCommand"
      @retry="handleLinuxSetupRetry"
      @skip="handleLinuxSetupSkip"
    />
  </div>
</template>
