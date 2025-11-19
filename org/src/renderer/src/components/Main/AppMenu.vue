<script setup lang="ts">
import type { ButtonProps, DropdownProps } from 'naive-ui'
import type { DropdownMixedOption } from 'naive-ui/es/dropdown/src/interface'
// import { useTesting } from '@renderer/store/testing'
import { NButton, NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  options?: DropdownMixedOption[]
  secondary?: ButtonProps['secondary']
  tertiary?: ButtonProps['tertiary']
  quaternary?: ButtonProps['quaternary']
  size?: ButtonProps['size']
  menuSize?: DropdownProps['size']
  menuPlacement?: DropdownProps['placement']
  iconClass?: string
}>()

const { t } = useI18n()
const ipcRenderer = window.electron.ipcRenderer

const options = computed<DropdownMixedOption[]>(() => [
  ...(props.options
    ? [
        ...props.options,
        {
          type: 'divider',
          key: 'divider',
        },
      ]
    : []),
  {
    label: t('about'),
    icon() {
      return h('i', { class: 'i-iw:info-circle' })
    },
    key: 'about',
    props: {
      onClick: () => {
        ipcRenderer.invoke('app:showAboutPanel')
      },
    },
  },
  {
    label: t('quit'),
    icon() {
      return h('i', { class: 'i-iw:quit text-red-400 dark:text-red-500' })
    },
    key: 'quit',
    props: {
      class: '*:text-red-400 *:dark:text-red-500',
      onClick: () => {
        ipcRenderer.invoke('app:quit')
      },
    },
  },
])
</script>

<template>
  <NDropdown
    class="select-none"
    trigger="click"
    :options="options"
    :placement="menuPlacement ? menuPlacement : 'bottom-end'"
    :size="menuSize ? menuSize : undefined"
  >
    <NButton
      :secondary="secondary ? secondary : false"
      :tertiary="tertiary ? tertiary : false"
      :quaternary="quaternary === undefined ? true : quaternary"
      :size="size ? size : 'large'"
      class="aspect-ratio-square p-0"
    >
      <i
        :class="[
          iconClass ? iconClass : 'i-iw:more size-6',
        ]"
      />
    </NButton>
  </NDropdown>
</template>
