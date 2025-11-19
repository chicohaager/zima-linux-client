<script setup lang="ts">
import type { User } from '@icewhale/zimaos-userservice-openapi/dist/v1'

defineProps<{
  user?: User
  currentConnectionPath?: ConnectionPath
}>()

const platform = window.platform
const ipcRenderer = window.electron.ipcRenderer
</script>

<template>
  <div
    class="h-fit w-full flex flex-col select-none gap-3"
  >
    <span class="select-none text-sm text-surface-500">
      {{ $t('explore') }}
    </span>
    <div class="grid grid-cols-2 gap-2">
      <ZimaBackupButton />
      <IconCardButton
        :name="$t('peerDrop')"
        icon-class="i-hugeicons:airdrop"
        @click="currentConnectionPath && ipcRenderer.invoke('PeerDropWindow:show')"
      />
      <IconCardButton
        :name="$t('openFiles')"
        :icon-class="platform === 'darwin' ? 'i-hugeicons:apple-finder' : 'i-hugeicons:folder-01'"
        @click="user && currentConnectionPath && ipcRenderer.invoke('samba:openSmbSharePath', { username: user?.username, password: ' ', address: currentConnectionPath?.remote_ipv4, path: '' })"
      />
    </div>
  </div>
</template>
