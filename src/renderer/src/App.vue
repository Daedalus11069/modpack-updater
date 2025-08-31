<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { promiseTimeout, useFileDialog } from '@vueuse/core'
import { Conf } from 'electron-conf/renderer'
import { BlobReader, Entry, TextWriter, ZipReader } from '@zip.js/zip.js'
import { FwbButton, FwbNavbar, FwbNavbarCollapse } from 'flowbite-vue'
import { CurseforgeV1Client, File } from '@xmcl/curseforge'
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
  oldFilename?: string
  addonID: number
  fileID: number
  changelog?: string
  downloadUrl?: string
  required: boolean
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
    running: false,
    finished: false,
    canceled: false
  }
})

const buttonsDisabled = ref<boolean>(true)

const abortController = ref<AbortController>(new AbortController())

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

async function manifestFileGetter(files: ManifestFile[] = [], signal: AbortSignal) {
  const requiredMap: Record<string, boolean> = {}
  const fileIDs = files.map(({ fileID, required }) => {
    requiredMap[`${fileID}`] = required
    return fileID
  })
  const fetchedFiles = (
    (await api.value!.getFiles(fileIDs, signal)) as unknown as ManifestFile[]
  ).map((addon) => {
    const { id, modId, fileName } = addon as unknown as File
    addon.projectID = modId
    addon.fileID = id
    // @ts-expect-error
    addon.filename = fileName
    addon.required = requiredMap[`${id}`]
    return addon
  })
  const modIDs = fetchedFiles.map(({ projectID }) => projectID)
  const mods = await api.value!.getMods(modIDs, signal)
  const updateFiles: UpdateFile[] = fetchedFiles.map((addon) => {
    const nameIdx = mods.findIndex((mod) => mod.id === addon.projectID)
    let name = ''
    if (nameIdx >= 0) {
      name = mods[nameIdx].name
    }
    return {
      name,
      addonID: addon.projectID,
      fileID: addon.fileID,
      // @ts-expect-error
      filename: addon.filename,
      downloadUrl: `${(addon as unknown as File).downloadUrl}`.replace(
        /^https:\/\/edge\./,
        'https://mediafiles.'
      ),
      required: addon.required
    }
  })
  return updateFiles
}

const cacheUpdateData = async (refresh = false) => {
  progress.value = 0
  const manifestIdx = modpackTree.value.findIndex((node) => node.label === 'manifest.json')
  if (manifestIdx >= 0) {
    const entry = modpackTree.value[manifestIdx].entry
    const manifest: ManifestData | UpdateData = refresh
      ? JSON.parse(await entry.getData(new TextWriter()))
      : updateData.value
    let files: (UpdateFile | ManifestFile)[] = manifest.files
    if (typeof api.value?.getMods !== 'undefined' && typeof api.value?.getFiles !== 'undefined') {
      files = await manifestFileGetter(files as ManifestFile[], abortController.value.signal)
    }
    updateData.value.files = files as UpdateFile[]
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
        filename: file.filename,
        downloadUrl: file.downloadUrl,
        required: file.required
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
          !installedAddons.some((installedAddon) => {
            if (
              addon.addonID === installedAddon.addonID &&
              addon.fileID !== installedAddon.fileID
            ) {
              addon.oldFilename = installedAddon.filename
            }
            return addon.fileID === installedAddon.fileID
          })
      )
      .filter((addon) => !newAddons.some((newAddon) => addon.addonID === newAddon.addonID))
      .sort((a, b) => a.name.localeCompare(b.name))

    const removedAddons = installedAddons
      .filter(
        (addon) => !updateAddons.some((updatedAddon) => updatedAddon.addonID === addon.addonID)
      )
      .filter(
        (addon) => !changedAddons.some((changedAddon) => addon.fileID === changedAddon.fileID)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    const disabledAddons = updateAddons
      .filter((addon) => addon.required === false)
      .sort((a, b) => a.name.localeCompare(b.name))

    console.log({ newAddons, changedAddons, removedAddons, disabledAddons })
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
  if (!updateDataState.loading.canceled && updateDataState.loading.running) {
    updateDataState.loading.canceled = true
    updateDataState.loading.running = false
    abortController.value.abort('Canceled')
  } else if (
    updateDataState.loading.started &&
    updateDataState.loading.canceled &&
    !updateDataState.loading.running
  ) {
    abortController.value = new AbortController()
    updateDataState.loading.running = true
    updateDataState.loading.canceled = false
    // cacheUpdateData()
  } else {
    abortController.value = new AbortController()
  }
}

onChange(async (files) => {
  if (files !== null) {
    const file = files[0]
    const zipFileReader = new ZipReader(new BlobReader(file))
    modpackFilename.value = file.name
    modpackTree.value = await buildTreeFromPaths(zipFileReader.getEntriesGenerator())
    // abortController.value = new AbortController()
    // updateDataState.loading.started = true
    // updateDataState.loading.running = true
    // updateDataState.loading.canceled = false
    // updateDataState.loading.finished = false
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
