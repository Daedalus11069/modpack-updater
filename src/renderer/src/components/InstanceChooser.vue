<script setup lang="ts">
import { useIpcRenderer } from '@vueuse/electron'
import { IpcRenderer } from 'electron'
import { Conf } from 'electron-conf/renderer'
import { FwbButton, FwbInput } from 'flowbite-vue'

import type { AppSettings } from 'src/shared/types'
import { onMounted, ref, watch } from 'vue'

const ipc = useIpcRenderer(window.electron.ipcRenderer as unknown as IpcRenderer)

const conf = new Conf<AppSettings>()
const instanceLocation = ref('')

async function chooseFolder() {
  const folder = await window.electron.ipcRenderer.invoke('choose-folder')
  if (folder !== null) {
    instanceLocation.value = folder
  }
}

watch(instanceLocation, () => {
  conf.set('instanceLocation', instanceLocation.value)
})

onMounted(async () => {
  instanceLocation.value = await conf.get('instanceLocation')
})
</script>

<template>
  <fwb-input v-model="instanceLocation">
    <template #suffix>
      <fwb-button @click="chooseFolder">Select</fwb-button>
    </template>
  </fwb-input>
</template>

<style scoped></style>
