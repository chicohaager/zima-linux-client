<script setup lang="ts">
import { FileApi, FolderApi } from '@icewhale/icewhale-files-openapi'
import { Connection } from '@renderer/utils/connection'
import { NAutoComplete } from 'naive-ui'
import neoBytes from 'neo-bytes'

const props = defineProps<{
  disabled?: boolean
}>()

const path = defineModel<string>('path', {
  default: '/DATA/Backup',
})

const valid = defineModel<boolean>('vaild', {
  default: false,
})

const whiteList = [
  '/DATA/',
  '/media/',
]

const fileList = ref<string[]>([])

function getFileList() {
  Connection.getDevice().then((device) => {
    if (device) {
      Connection.getCurrentConnectionPath().then((currentConnectionPath) => {
        if (currentConnectionPath) {
          const fileApi = new FileApi(
            undefined,
            `http://${currentConnectionPath.remote_ipv4}:${device.port ?? 80}/v2`,
          )
          fileApi.getFiles(path.value)
            .then((res) => {
              if (res.status === 200) {
                fileList.value = res.data.content!.filter((item) => {
                  return item.is_dir && whiteList.some((base) => {
                    return item.path!.startsWith(base)
                  })
                }).map((item) => {
                  return item.path!
                })
              }
            })
            .catch((err) => {
              console.error(err)
              if (path.value.split('/').length === 2) {
                fileList.value = whiteList
              }
            })
        }
      })
    }
  })
}

const availableSpace = ref<number | null>(null)
function getAvailableSpace(folder?: string) {
  Connection.getDevice().then((device) => {
    if (device) {
      Connection.getCurrentConnectionPath().then((currentConnectionPath) => {
        if (currentConnectionPath) {
          const folderApi = new FolderApi(
            undefined,
            `http://${currentConnectionPath.remote_ipv4}:${device.port ?? 80}/v2`,
          )
          folderApi.getFolderInfo(folder ?? path.value)
            .then((res) => {
              if (res.status === 200) {
                availableSpace.value = res.data[0].free ?? null
              }
            })
            .catch((err) => {
              console.error(err)
              if (path.value.split('/').length <= 2) {
                availableSpace.value = null
              }
              else {
                // If the path is not valid, we need to get the available space of the parent folder
                const currentPath = path.value.endsWith('/') ? path.value.slice(0, -1) : path.value
                const parentPath = currentPath.split('/').slice(0, -1).join('/')
                getAvailableSpace(parentPath)
              }
            })
            .finally(() => {
              valid.value = !!availableSpace.value
            })
        }
      })
    }
  })
}

onMounted(() => {
  getFileList()
  getAvailableSpace()
})
</script>

<template>
  <div class="w-full flex flex-col gap-1">
    <NAutoComplete
      v-model:value="path"
      :input-props="{
        autocomplete: 'disable',
      }"
      :options="fileList"
      :get-show="() => true"
      :menu-props="{
        class: fileList.length > 3 ? 'h-30' : '',
      }"
      placeholder=""
      :disabled="props.disabled"
      @update:value="() => {
        getFileList()
        getAvailableSpace()
      }"
      @focus="getFileList()"
    />
    <span
      class="text-surface-400 dark:text-surface-600"
    >
      {{
        availableSpace
          ? $t('availableSpace', { space: neoBytes(availableSpace) })
          : ''
      }}
    </span>
  </div>
</template>
