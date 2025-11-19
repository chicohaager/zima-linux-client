import { defineStore } from 'pinia'
import semver from 'semver'

interface CallbackHook {
  start?: () => void
  then?: (res?: any) => void
  catch?: (err?: any) => void
  finally?: () => void
}

export const useZeroTierService = defineStore('zerotier-service', () => {
  // Settings
  const INTERVAL = 1000

  // Utils
  const installerVersion = import.meta.env.VITE_ZEROTIER_INSTALLER_VERSION
  const ipcRenderer = window.electron.ipcRenderer
  const monitorTimer = ref<NodeJS.Timeout>()

  // States
  const installed = ref<string | false>()
  const running = ref<boolean>()
  const authtoken = ref<string | null>()
  const monitoring = ref<boolean>()
  const hasCapabilities = ref<boolean>()
  const setcapCommand = ref<string>('')
  const cantGetAuthToken = computed(() => authtoken.value === null)
  const needUpdate = computed(() => !installed.value ? false : semver.gt(installerVersion, installed.value))
  const needsCapabilities = computed(() => window.platform === 'linux' && installed.value && !hasCapabilities.value)

  // Loading flags
  const checkingInstallation = ref(false)
  const checkingRunning = ref(false)
  const gettingAuthToken = ref(false)
  const initializingAuthToken = ref(false)
  const installing = ref(false)
  const uninstalling = ref(false)
  const starting = ref(false)
  const stopping = ref(false)

  // Actions
  function checkInstallation(callback?: CallbackHook) {
    checkingInstallation.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:checkInstallation')
      .then((res: string | false) => {
        installed.value = res
        callback?.then?.(res)
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        checkingInstallation.value = false
        callback?.finally?.()
      })
  }

  function checkRunning(callback?: CallbackHook) {
    checkingRunning.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:checkRunning')
      .then((res: boolean) => {
        running.value = res
        callback?.then?.(res)
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        checkingRunning.value = false
        callback?.finally?.()
      })
  }

  function getAuthToken(callback?: CallbackHook) {
    gettingAuthToken.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:getAuthToken')
      .then((res: string | null) => {
        authtoken.value = res
        callback?.then?.(res)
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        gettingAuthToken.value = false
        callback?.finally?.()
      })
  }

  function checkCapabilities(callback?: CallbackHook) {
    callback?.start?.()
    ipcRenderer.invoke('zts:checkCapabilities')
      .then((res: boolean) => {
        hasCapabilities.value = res
        callback?.then?.(res)
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        callback?.finally?.()
      })
  }

  function getSetcapCommand(callback?: CallbackHook) {
    callback?.start?.()
    ipcRenderer.invoke('zts:getSetcapCommand')
      .then((res: string) => {
        setcapCommand.value = res
        callback?.then?.(res)
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        callback?.finally?.()
      })
  }

  function initAuthToken(callback?: CallbackHook) {
    initializingAuthToken.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:initAuthToken')
      .then(() => {
        authtoken.value = null
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        initializingAuthToken.value = false
        callback?.finally?.()
      })
  }

  function install(callback?: CallbackHook) {
    installing.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:install')
      .then(() => {
        installed.value = installerVersion
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        installing.value = false
        callback?.finally?.()
      })
  }

  function uninstall(callback?: CallbackHook) {
    uninstalling.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:uninstall')
      .then(() => {
        installed.value = false
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        uninstalling.value = false
        callback?.finally?.()
      })
  }

  function start(callback?: CallbackHook) {
    starting.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:start')
      .then(() => {
        running.value = true
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        starting.value = false
        callback?.finally?.()
      })
  }

  function stop(callback?: CallbackHook) {
    stopping.value = true
    callback?.start?.()
    ipcRenderer.invoke('zts:stop')
      .then(() => {
        running.value = false
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        stopping.value = false
        callback?.finally?.()
      })
  }

  const monitorChecking = ref(false)
  async function feMonitorCheck() {
    monitorChecking.value = true
    try {
      installed.value = await ipcRenderer.invoke('zts:installed')
      running.value = await ipcRenderer.invoke('zts:running')
      authtoken.value = await ipcRenderer.invoke('zts:getAuthToken')
      monitoring.value = await ipcRenderer.invoke('zts:monitoring')
      !monitoring.value && stopMonitor()
    }
    catch (err: any) {
      console.error(err)
    }
    finally {
      monitorChecking.value = false
    }
  }

  function startMonitor(callback?: CallbackHook) {
    callback?.start?.()
    stopMonitor({
      then: () => {
        monitorTimer.value = setInterval(feMonitorCheck, INTERVAL)
        ipcRenderer.invoke('zts:startMonitor')
          .then(() => {
            monitoring.value = true
            callback?.then?.()
          })
          .catch((err: any) => {
            console.error(err)
            callback?.catch?.(err)
          })
          .finally(() => {
            callback?.finally?.()
          })
      },
    })
  }

  function stopMonitor(callback?: CallbackHook) {
    callback?.start?.()
    clearInterval(monitorTimer.value)
    monitorTimer.value = undefined
    ipcRenderer.invoke('zts:stopMonitor')
      .then(() => {
        monitoring.value = false
        callback?.then?.()
      })
      .catch((err: any) => {
        console.error(err)
        callback?.catch?.(err)
      })
      .finally(() => {
        callback?.finally?.()
      })
  }

  return {
    installed,
    running,
    authtoken,
    monitoring,
    hasCapabilities,
    setcapCommand,
    cantGetAuthToken,
    needUpdate,
    needsCapabilities,
    checkingInstallation,
    checkingRunning,
    gettingAuthToken,
    initializingAuthToken,
    installing,
    uninstalling,
    starting,
    stopping,
    checkInstallation,
    checkRunning,
    getAuthToken,
    checkCapabilities,
    getSetcapCommand,
    initAuthToken,
    install,
    uninstall,
    start,
    stop,
    startMonitor,
    stopMonitor,
  }
})
