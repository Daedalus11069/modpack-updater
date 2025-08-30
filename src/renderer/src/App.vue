<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { promiseTimeout, useFileDialog } from '@vueuse/core'
import { Conf } from 'electron-conf/renderer'
import { BlobReader, Entry, TextWriter, ZipReader } from '@zip.js/zip.js'
import { FwbButton, FwbNavbar, FwbNavbarCollapse } from 'flowbite-vue'
import { CurseforgeV1Client } from '@xmcl/curseforge'
import Tree from 'primevue/tree'
import { TreeNode } from 'primevue/treenode'
import ProgressBar from 'primevue/progressbar'
import ThemeToggler from './components/ThemeToggler.vue'
import InstanceChooser from './components/InstanceChooser.vue'
import APIKey from './components/APIKey.vue'
import type { AppSettings } from 'src/shared/types'

interface UpdateFile {
  name: string
  filename: string
  newFilename?: string
  addonID: number
  fileID: number
  changelog?: string
}

interface UpdateData {
  files: UpdateFile[]
}

interface ManifestFile {
  projectID: number
  fileID: number
  required: boolean
}

interface ManifestData {
  files: ManifestFile[]
}

const writer = new TextWriter()
const conf = new Conf<AppSettings>()
const modpackFilename = ref<string>('')
const modpackTree = ref<TreeNode[]>([])
const progress = ref<number>(0)
const progressText = ref<string>('')
const api = ref<CurseforgeV1Client>()
const updateData = ref<UpdateData>({
  files: []
})

const updateDataState = reactive({
  loading: {
    started: false,
    finished: false,
    canceled: false
  }
})

const buttonsDisabled = ref<boolean>(true)

const { open, onChange } = useFileDialog({
  accept: 'zip/*' // Set to accept only zip files
})

async function buildTreeFromPaths(paths: AsyncGenerator<Entry, boolean>): Promise<TreeNode[]> {
  const tree: TreeNode[] = []
  const nodeMap = new Map()

  for await (const path of paths) {
    let currentNodeArray: TreeNode[] = tree
    let currentPath = ''

    const segments = path.filename.split('/')

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      currentPath = currentPath ? `${currentPath}/${segment}` : segment

      // Check if a node for the current path segment already exists
      let existingNode = nodeMap.get(currentPath)

      if (!existingNode) {
        // Determine if it's a file or a folder
        const isFile = i === segments.length - 1

        existingNode = {
          key: currentPath,
          label: segment,
          icon: isFile ? 'pi pi-file' : 'pi pi-folder',
          children: isFile ? null : [],
          isFile,
          entry: isFile ? path : null
        }

        // Add the new node to its parent's children array
        currentNodeArray.push(existingNode)

        // Add to the map for quick lookup
        nodeMap.set(currentPath, existingNode)
      }

      // If it's a folder, move down one level to the children array
      if (existingNode.children) {
        currentNodeArray = existingNode.children
      }
    }
  }

  return tree
}

const update = () => {
  console.log(modpackTree.value)
}

const cacheUpdateData = async (refresh = false) => {
  const manifestIdx = modpackTree.value.findIndex((node) => node.label === 'manifest.json')
  if (manifestIdx >= 0) {
    const entry = modpackTree.value[manifestIdx].entry
    const manifest: ManifestData | UpdateData = refresh
      ? JSON.parse(await entry.getData(writer))
      : updateData.value
    let idx = 0
    let files: (UpdateFile | ManifestFile)[] = manifest.files
    progress.value = 0
    if (typeof api.value?.getMod !== 'undefined') {
      let breaker = 0
      for await (const file of files as ManifestFile[]) {
        const { projectID, fileID } = file
        if (typeof (file as unknown as UpdateFile).name === 'undefined') {
          const { name } = await api.value.getMod(projectID)
          const { fileName } = await api.value.getModFile(projectID, fileID)
          // const changelog = await api.value.getModFileChangelog(projectID, fileID)
          files.push({
            name,
            filename: fileName,
            addonID: projectID,
            fileID
          })
          progress.value = Math.trunc(((idx + 1) / manifest.files.length) * 100)
          console.log(updateDataState.loading.canceled)
          if (updateDataState.loading.canceled) {
            break
          }
          breaker++
          if (breaker > 10) {
            breaker = 0
            await promiseTimeout(2000)
          }
        }
      }
    }
    Object.assign(updateData.value, manifest)
    if (idx === manifest.files.length - 1) {
      updateDataState.loading.started = false
      updateDataState.loading.finished = true
    }
    promiseTimeout(600).then(() => {
      progress.value = 0
    })
  }
}

const viewChangelogs = async () => {
  const instanceJson = await window.electron.ipcRenderer.invoke('get-instance-json')
  const installedAddons = instanceJson.installedAddons.map((addon) => ({
    name: addon.name,
    addonID: addon.addonID,
    fileID: addon.installedFile.id,
    filename: addon.installedFile.fileNameOnDisk
  }))

  if (typeof updateData.value !== 'undefined') {
    const updateAddons: UpdateFile[] = updateData.value.files
      .map((file) => ({
        name: file.name,
        addonID: file.addonID,
        fileID: file.fileID,
        filename: file.filename
      }))
      .filter(({ name }) => name)

    const newAddons = updateAddons
      .filter(
        (addon) => !installedAddons.some((currentAddon) => currentAddon.addonID === addon.addonID)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    const changedAddons = updateAddons
      .filter(
        (addon) =>
          !installedAddons.some((newAddon) => {
            if (addon.fileID !== newAddon.fileID) {
              addon.newFilename = newAddon.filename
            }
            return addon.fileID === newAddon.fileID
          })
      )
      .filter((addon) => !newAddons.some((newAddon) => addon.addonID === newAddon.addonID))
      .sort((a, b) => a.name.localeCompare(b.name))

    const removedAddons = installedAddons
      .filter((addon) => !updateAddons.some((newAddon) => newAddon.addonID === addon.addonID))
      .filter(
        (addon) => !changedAddons.some((changedAddon) => addon.fileID === changedAddon.fileID)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    console.log({ newAddons, changedAddons, removedAddons })
  }
}

const dataLoadingBtnDisabled = computed<boolean>(() => {
  return !updateDataState.loading.started && !updateDataState.loading.finished
})

const dataLoadingState = computed<{ state: 'Cancel' | 'Resume'; color: 'red' | 'green' }>(() => {
  if (updateDataState.loading.started && !updateDataState.loading.canceled) {
    return { state: 'Cancel', color: 'red' }
  } else if (!updateDataState.loading.started || updateDataState.loading.finished) {
    return { state: 'Resume', color: 'green' }
  }
  return { state: 'Resume', color: 'green' }
})

const controlLoading = () => {
  updateDataState.loading.canceled = !updateDataState.loading.canceled
  if (updateDataState.loading.started && updateDataState.loading.canceled) {
    updateDataState.loading.canceled = false
    cacheUpdateData()
  }
}

onChange(async (files) => {
  if (files !== null) {
    const file = files[0]
    const zipFileReader = new ZipReader(new BlobReader(file))
    modpackFilename.value = file.name
    modpackTree.value = await buildTreeFromPaths(zipFileReader.getEntriesGenerator())
    updateDataState.loading.started = true
    cacheUpdateData(true).then(() => {
      buttonsDisabled.value = false
    })
  }
})

watch(api, async () => {
  const key = await conf.get('APIKey')
  if (key !== '') {
    api.value = new CurseforgeV1Client(key)
  }
})

onMounted(async () => {
  api.value = new CurseforgeV1Client(await conf.get('APIKey'))
})
</script>

<template>
  <div class="h-full flex flex-col">
    <fwb-navbar solid>
      <template #logo> Modpack Updater </template>
      <template #default="{ isShowMenu }">
        <fwb-navbar-collapse :is-show-menu="isShowMenu"> </fwb-navbar-collapse>
      </template>
      <template #right-side>
        <theme-toggler />
      </template>
    </fwb-navbar>
    <div class="flex flex-col bg-white dark:bg-gray-700 dark:text-white grow p-4">
      <div class="basis-auto">
        <APIKey class="mb-3" type="password" />
        <InstanceChooser />
      </div>
      <div class="grow">
        <div class="flex gap-3">
          <div class="basis-4/12">
            <div class="flex justify-between">
              <fwb-button class="my-3" @click="open">Choose Modpack</fwb-button>
              <div class="flex items-center justify-center" v-if="modpackFilename">
                <strong class="me-2"> Active: </strong>
                {{ modpackFilename }}
              </div>
            </div>
            <div class="flex">
              <fwb-button
                class="mb-3"
                :color="dataLoadingState.color"
                @click="controlLoading"
                :disabled="dataLoadingBtnDisabled"
              >
                {{ dataLoadingState.state }} Load
              </fwb-button>
            </div>
            <Tree :value="modpackTree" class="w-full"></Tree>
          </div>
          <div class="basis-8/12">
            <div class="flex">
              <div class="basis-1/2">
                <fwb-button class="my-3" @click="viewChangelogs" :disabled="buttonsDisabled">
                  View Changelogs
                </fwb-button>
              </div>
              <div class="basis-1/2 flex justify-end">
                <fwb-button class="my-3" @click="update" :disabled="buttonsDisabled">
                  Update Modpack
                </fwb-button>
              </div>
            </div>
            <div>
              <ProgressBar :value="progress">{{ progress }}% {{ progressText }}</ProgressBar>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
