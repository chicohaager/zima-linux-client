<script setup lang="ts">
import type { DriveInfo as DeviceInfo } from '@icewhale/icewhale-drive-openapi'
import type { InputInst } from 'naive-ui'
import { Config } from '@renderer/utils/config'
import { Connection } from '@renderer/utils/connection'
import { openExternal } from '@renderer/utils/shell'
import { NButton, NInput, useNotification } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()
const notification = useNotification()

const device = ref<DeviceInfo>()

const username = ref('')
const password = ref('')

const loggingIn = ref(false)

const usernameInput = ref<InputInst | null>(null)
const passwordInput = ref<InputInst | null>(null)

function login() {
  loggingIn.value = true
  Connection.getDevice()
    .then((dev) => {
      device.value = dev
      if (!device.value) {
        notification.error({
          title: 'No device found',
          content: 'Please connect to a device first.',
          duration: 5000,
        })
        loggingIn.value = false
        router.replace('/Device/ConnectUsingLanDiscovery')
        return
      }
      Connection.getCurrentConnectionPath()
        .then((path) => {
          if (path) {
            Connection.login(username.value, password.value)
              .then(() => {
                Config.set('connection.lastUsername', username.value)
                router.replace('/Device/LoginSuccess')
              })
              .catch((err: Error) => {
                console.error(err)
                if (err.message.includes('status code 400')) {
                  notification.error({
                    title: t('loginFailed'),
                    content: t('checkUsernameAndPassword'),
                    duration: 5000,
                  })
                }
                else if (err.message.includes('status code 429')) {
                  notification.error({
                    title: t('triedTooManyTimes'),
                    content: t('tryAgainLater'),
                    duration: 5000,
                  })
                }
                else {
                  notification.error({
                    title: t('somethingWentWrong'),
                    content: err.message,
                    duration: 5000,
                  })
                }
              })
              .finally(() => {
                loggingIn.value = false
              })
          }
          else {
            notification.warning({
              title: t('deviceConnectionNotReady'),
              content: t('tryAgainLater'),
              duration: 5000,
            })
            loggingIn.value = false
          }
        })
        .catch((err: Error) => {
          console.error(err)
          notification.error({
            title: t('somethingWentWrong'),
            content: err.message,
            duration: 5000,
          })
          loggingIn.value = false
        })
    })
    .catch((err: Error) => {
      notification.error({
        title: t('somethingWentWrong'),
        content: err.message,
        duration: 5000,
      })
    })
}

onMounted(async () => {
  Config.get('connection.lastUsername')
    .then((value) => {
      username.value = value
      if (value) {
        passwordInput.value?.focus()
      }
      else {
        usernameInput.value?.focus()
      }
    })

  Connection.getDevice().then((dev) => {
    device.value = dev
  }).catch((err) => {
    console.error(err)
    router.replace('/Device/ConnectUsingLanDiscovery')
  })
})
</script>

<template>
  <WindowControl :title="$t('login')" hide-title />
  <div
    class="absolute left-0 top-0 h-vh w-vw flex flex-col justify-between justify-between gap-4 bg-surface-0 bg-cover p-10 dark:bg-surface-950"
  >
    <span class="text-4xl text-surface-900 dark:text-surface-50">
      {{ $t('loginTo', { device_name: device?.device_name || device?.device_model || 'Zima' }) }}
    </span>

    <form
      class="flex items-end justify-between"
      @submit.prevent="login"
    >
      <div class="w-60 flex flex-col items-start gap-4">
        <NInput
          ref="usernameInput"
          v-model:value="username"
          type="text"
          :placeholder="$t('username')"
          bordered clearable
          :input-props="{
            autocorrect: 'off',
            autocapitalize: 'off',
            spellcheck: false,
          }"
        />
        <NInput
          ref="passwordInput"
          v-model:value="password"
          type="password"
          :placeholder="$t('password')"
          show-password-on="click"
          bordered clearable
          :input-props="{
            autocorrect: 'off',
            autocapitalize: 'off',
            spellcheck: false,
          }"
        />
        <NButton
          :focusable="false"
          quaternary
          size="tiny"
          class="text-surface-400 dark:text-surface-500"
          @click="openExternal('https://docs.zimaspace.com/docs/ForgotPassword.html')"
        >
          {{ $t('forgotPassword') }}
        </NButton>
      </div>
      <div class="size-fit flex items-center">
        <NButton
          circle
          size="large"
          class="h-fit w-fit p-5"
          type="primary"
          attr-type="submit"
          :loading="loggingIn"
          :disabled="!username || !password"
        >
          <template #icon>
            <i class="i-iw:right-forward size-6" />
          </template>
        </NButton>
      </div>
    </form>
  </div>
</template>
