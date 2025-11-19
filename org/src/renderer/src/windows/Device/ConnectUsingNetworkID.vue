<script setup lang="ts">
import { Config } from '@renderer/utils/config'
import { Connection } from '@renderer/utils/connection'
import { openExternal } from '@renderer/utils/shell'
import { NAutoComplete, NButton, NTooltip, useNotification } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const ipcRenderer = window.electron.ipcRenderer

const { t } = useI18n()
const router = useRouter()

const notification = useNotification()

const lastNetworkId = ref<string>()
const networkId = ref('')
const networkIdValid = computed(() => /^[a-f0-9]{16}$/.test(networkId.value))

const connecting = ref(false)
function connect() {
  connecting.value = true
  Connection.getDeviceByNetworkId(toRaw(networkId.value))
    .then(({ device, networkId, remote_ipv4 }) => {
      Connection.setDevice(device)
      Connection.setZtNetwork({
        networkId,
        remote_ipv4,
      })
      Connection.waitForDeviceConnectionPathReady({
        onReady(path) {
          Config.set('device.lastNetworkId', networkId)
          if (device.initialized) {
            router.replace('/Device/Login')
          }
          else {
            ipcRenderer.invoke('shell:openExternal', `http://${path.remote_ipv4}:${device.port}`)
            ipcRenderer.invoke('window:close')
          }
        },
        onFailed(err) {
          console.error(err)
          notification.error({
            title: t('connectToDeviceFailed'),
            content: err.message,
            duration: 5000,
          })
          connecting.value = false
        },
      })
    })
    .catch((err: Error) => {
      console.error(err)
      if (err.message.includes('OS version is too low')) {
        notification.error({
          title: t('deviceOsNeedsUpdate'),
          content: t('deviceOsNeedsUpdateContent'),
          duration: 5000,
        })
      }
      else if (err.message.includes('App version is too low')) {
        notification.error({
          title: t('appNeedsUpdate'),
          content: t('appNeedsUpdateContent'),
          duration: 5000,
        })
      }
      else {
        notification.error({
          title: t('connectUsingNetworkIDFailed'),
          content: err.message,
          duration: 5000,
        })
      }
      connecting.value = false
    })
}

onMounted(() => {
  Config.get('device.lastNetworkId')
    .then((value) => {
      lastNetworkId.value = value
    })

  watch(
    () => networkId.value,
    (value, old) => {
      // a-z 0-9 max length 16
      const allowInput = /^[a-f0-9]{0,16}$/.test(value)
      if (!allowInput) {
        networkId.value = old ?? ''
      }
    },
    {
      immediate: true,
    },
  )
})
</script>

<template>
  <WindowControl :title="$t('connectUsingNetworkID')" hide-title />
  <div class="size-full flex flex-col select-none justify-between gap-4">
    <span class="text-4xl">
      {{ t('connectUsingNetworkID') }}
    </span>
    <form
      id="networkIdForm"
      class="app-no-drag flex translate-y-6 items-center justify-center"
      @submit.prevent="connect"
    >
      <div class="w-80 flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <label for="networkId">
            {{ t('networkId') }}
          </label>
          <NTooltip trigger="hover" placement="right" content-class="m-0! p-0!">
            <template #trigger>
              <NButton
                text type="tertiary"
                @click="openExternal('https://docs.zimaboard.com/docs/GetNetworkID.html')"
              >
                <i class="i-iw:help-circle text-surface-400 dark:text-surface-500" />
              </NButton>
            </template>
            {{ $t('howToGetNetworkId') }}
          </NTooltip>
        </div>
        <NAutoComplete
          v-model:value="networkId"
          v-focus
          :menu-props="{
            class: 'app-no-drag',
          }"
          :input-props="{
            autocorrect: 'off',
            autocapitalize: 'off',
            spellcheck: false,
            type: 'text',
          }"
          :show-empty="!!lastNetworkId"
          :get-show="() => !networkId"
          :disabled="connecting"
          :options="lastNetworkId ? [{
            type: 'group',
            label: $t('lastConnected'),
            key: 'lastConnected',
            children: [{
              value: lastNetworkId,
              label: lastNetworkId,
            }],
          }] : []"
          placeholder=""
          bordered
          clearable
          :status="!networkId ? 'success' : networkIdValid ? 'success' : 'error'"
        />
        <span class="text-xs text-red-500" :class="!networkIdValid && networkId ? 'opacity-100' : 'opacity-0'">
          {{ $t('networkIdInvalid') }}
        </span>
      </div>
    </form>
    <div class="flex items-center justify-between *:*:app-no-drag">
      <div class="flex items-center">
        <RouterLink to="/Device/ConnectUsingLanDiscovery" replace>
          <NButton quaternary type="primary">
            {{ $t('connectUsingLanDiscovery') }}
          </NButton>
        </RouterLink>
      </div>
      <div class="flex items-center gap-3">
        <NButton
          type="primary"
          attr-type="submit"
          form="networkIdForm"
          :disabled="!networkId || !networkIdValid"
          :loading="connecting"
        >
          {{ $t('connect') }}
        </NButton>
      </div>
    </div>
  </div>
</template>
