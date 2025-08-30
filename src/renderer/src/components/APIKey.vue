<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Conf } from 'electron-conf/renderer'
import { FwbInput } from 'flowbite-vue'
import type { AppSettings } from 'src/shared/types'

const conf = new Conf<AppSettings>()
const APIKey = ref('')

watch(APIKey, () => {
  conf.set('APIKey', APIKey.value)
})

onMounted(async () => {
  APIKey.value = await conf.get('APIKey')
})
</script>

<template>
  <fwb-input v-model="APIKey" placeholder="API Key" />
</template>

<style scoped></style>
