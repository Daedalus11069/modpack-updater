<script setup lang="ts">
import { computed, onMounted, reactive, ref, useTemplateRef, watch } from 'vue'
import { promiseTimeout, useElementSize, useFileDialog, useWindowSize } from '@vueuse/core'
import { Conf } from 'electron-conf/renderer'
import { BlobReader, Entry, TextWriter, ZipReader } from '@zip.js/zip.js'
import { FwbButton, FwbNavbar, FwbNavbarCollapse, FwbSpinner } from 'flowbite-vue'
import { CurseforgeV1Client, File } from '@xmcl/curseforge'
import Tree from 'primevue/tree'
import ProgressBar from 'primevue/progressbar'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import { marked } from 'marked'
import ThemeToggler from './components/ThemeToggler.vue'
import InstanceChooser from './components/InstanceChooser.vue'
import APIKey from './components/APIKey.vue'
import type { AppSettings, FlattenedEntry, TreeNodeEntry, UpdateFile } from 'src/shared/types'

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
const modpackPaths = ref<Entry[]>([])
const modpackTree = ref<TreeNodeEntry[]>([])
const progress = ref<number>(0)
const progressText = ref<string>('')
const api = ref<CurseforgeV1Client>()
const updateData = ref<UpdateData>({
  files: []
})
const modpackUpdate = ref<{
  newAddons: UpdateFile[]
  changedAddons: UpdateFile[]
  removedAddons: UpdateFile[]
  disabledAddons: UpdateFile[]
}>({ newAddons: [], changedAddons: [], removedAddons: [], disabledAddons: [] })
const spinnerVisible = ref<boolean>()

const mainArea = useTemplateRef('mainArea')
const navArea = useTemplateRef('navArea')
const configArea = useTemplateRef('configArea')
const bottomArea = useTemplateRef('bottomArea')
const bottomAreaContainer = useTemplateRef('bottomAreaContainer')
const changelogsHeader = useTemplateRef('changelogsHeader')

const windowSize = useWindowSize({
  type: 'visual'
})
const navAreaSize = useElementSize(
  navArea,
  { width: 0, height: 0 },
  {
    box: 'border-box'
  }
)
const configAreaSize = useElementSize(
  configArea,
  { width: 0, height: 0 },
  {
    box: 'border-box'
  }
)
const changelogsHeaderSize = useElementSize(changelogsHeader)

const bottomAreaheight = computed(() => {
  const size =
    windowSize.height.value -
    parseFloat(getComputedStyle(mainArea.value!).paddingTop.replace('px', '')) * 2 -
    navAreaSize.height.value -
    configAreaSize.height.value -
    parseFloat(getComputedStyle(bottomArea.value!).marginTop.replace('px', '')) -
    parseFloat(getComputedStyle(bottomAreaContainer.value!).marginTop.replace('px', '')) -
    changelogsHeaderSize.height.value
  return size + 'px'
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

async function buildTreeFromPaths(paths: Entry[]): Promise<TreeNodeEntry[]> {
  const tree: TreeNodeEntry[] = []
  const nodeMap = new Map()

  for await (const path of paths) {
    let currentNodeArray: TreeNodeEntry[] = tree
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

const flattenTree = (node: TreeNodeEntry): FlattenedEntry[] => {
  const flattened: FlattenedEntry[] = []

  function recurse(nodeList) {
    if (!nodeList) {
      return
    }
    nodeList.forEach((node) => {
      // Create a shallow copy of the node to avoid mutating the original data.
      const nodeCopy = { ...node }

      // Remove the children property to ensure the node is flat.
      delete nodeCopy.children
      flattened.push(nodeCopy)

      // Recurse on the children.
      if (node.children) {
        recurse(node.children)
      }
    })
  }

  if (typeof node.children !== 'undefined') {
    recurse(node.children)
  }
  return flattened
}

const getTreeContent = async (node: TreeNodeEntry) => {
  if (typeof node.children !== 'undefined' && node.children !== null) {
    for (const treeNode of node.children) {
      if (treeNode.children !== null) {
        await getTreeContent(treeNode)
      } else if (
        treeNode.isFile &&
        typeof treeNode.entry !== 'undefined' &&
        typeof treeNode.entry.getData !== 'undefined'
      ) {
        treeNode.content = await treeNode.entry.getData(new TextWriter())
      }
    }
  }
  if (
    node.isFile &&
    typeof node.entry !== 'undefined' &&
    typeof node.entry.getData !== 'undefined'
  ) {
    node.content = await node.entry.getData(new TextWriter())
  }
  return node
}

const countFiles = (nodes: Entry[]) => {
  let count = 0
  for (const node of nodes) {
    if (!node.directory) {
      count++
    }
  }
  // if (typeof node.children !== 'undefined' && node.children !== null) {
  //   for (const treeNode of node.children) {
  //     if (treeNode.children !== null) {
  //       count = countTreeLeafs(treeNode, count)
  //     } else if (treeNode.isFile) {
  //       count++
  //     }
  //   }
  // }
  // if (node.isFile) {
  //   count++
  // }
  return count
}

const updateModpack = async () => {
  console.log(modpackPaths.value, modpackTree.value, modpackUpdate.value)
  const overridesIdx = modpackTree.value.findIndex((node) => node.key === 'overrides')
  if (
    overridesIdx >= 0 &&
    typeof modpackTree.value[overridesIdx] !== 'undefined' &&
    modpackTree.value[overridesIdx] !== null
  ) {
    let overridesTotal = countFiles(
      modpackPaths.value.filter((node) => /^overrides\//.test(node.filename))
    )
    const overrides = await getTreeContent(modpackTree.value[overridesIdx])
    const overridesFlattened = flattenTree(overrides).filter((node) => node.isFile)
    console.log({ overridesTotal, overridesFlattened })
    // buttonsDisabled.value = true
    // window.electron.ipcRenderer.send('update-modpack', {
    //   overrides,
    //   overridesTotal,
    //   ...modpackUpdate.value
    // })
  }
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
    if (typeof entry.getData !== 'undefined') {
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
}

const processModpackChanges = async () => {
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

    for await (const addon of changedAddons) {
      if (typeof api.value?.getModFileChangelog !== 'undefined') {
        const changelog = await api.value.getModFileChangelog(
          addon.addonID,
          addon.fileID,
          abortController.value.signal
        )
        addon.changelog = await marked.parse(changelog)
      }
    }

    modpackUpdate.value.newAddons = newAddons
    modpackUpdate.value.changedAddons = changedAddons
    modpackUpdate.value.disabledAddons = disabledAddons
    modpackUpdate.value.removedAddons = removedAddons
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
    if (typeof file !== 'undefined' && file !== null) {
      spinnerVisible.value = true
      const zipFileReader = new ZipReader(new BlobReader(file))
      modpackFilename.value = file.name
      modpackPaths.value = await zipFileReader.getEntries()
      modpackTree.value = await buildTreeFromPaths(modpackPaths.value)
      // abortController.value = new AbortController()
      // updateDataState.loading.started = true
      // updateDataState.loading.running = true
      // updateDataState.loading.canceled = false
      // updateDataState.loading.finished = false
      await cacheUpdateData(true)
      await processModpackChanges()
      buttonsDisabled.value = false
      spinnerVisible.value = false
    }
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
    <fwb-navbar solid ref="navArea">
      <template #logo> Modpack Updater </template>
      <template #default="{ isShowMenu }">
        <fwb-navbar-collapse :is-show-menu="isShowMenu"> </fwb-navbar-collapse>
      </template>
      <template #right-side>
        <theme-toggler />
      </template>
    </fwb-navbar>
    <div
      class="flex flex-col bg-white dark:bg-gray-700 dark:text-white grow p-4 h-full"
      ref="mainArea"
    >
      <div ref="configArea">
        <APIKey class="mb-3" type="password" />
        <InstanceChooser />
      </div>
      <div class="grow flex flex-col h-full" ref="bottomArea">
        <div class="flex gap-3 grow h-full mt-3" ref="bottomAreaContainer">
          <div id="mod-filetree-area" class="basis-4/12 flex flex-col h-full">
            <div class="flex justify-between">
              <fwb-button class="mb-3" @click="open">
                Choose Modpack
                <template #suffix>
                  <fwb-spinner color="white" v-if="spinnerVisible" />
                </template>
              </fwb-button>
              <div class="flex items-center justify-center" v-if="modpackFilename">
                <strong class="me-2"> Active: </strong>
                {{ modpackFilename }}
              </div>
            </div>
            <!-- <div class="flex">
              <fwb-button
                class="mb-3"
                :color="dataLoadingState.color"
                @click="controlLoading"
                :disabled="dataLoadingBtnDisabled"
              >
                {{ dataLoadingState.state }} Load
              </fwb-button>
            </div> -->
            <Tree :value="modpackTree" :class="`w-full overflow-y-auto`"></Tree>
          </div>
          <div id="mod-update-area" class="basis-4/12 h-full">
            <h3 ref="changelogsHeader">Changelogs:</h3>
            <div :class="`basis-1/2 h-full overflow-y-auto`">
              <Accordion>
                <AccordionPanel :value="addon.addonID" v-for="addon in modpackUpdate.changedAddons">
                  <AccordionHeader>{{ addon.name }}</AccordionHeader>
                  <AccordionContent>
                    <p class="m-0 prose dark:prose-invert" v-html="addon.changelog"></p>
                  </AccordionContent>
                </AccordionPanel>
              </Accordion>
            </div>
          </div>
          <div class="basis-4/12">
            <div class="flex items-center gap-3">
              <fwb-button @click="updateModpack" :disabled="buttonsDisabled">
                Update Modpack
              </fwb-button>
              <ProgressBar class="grow" :value="progress">
                {{ progress }}% {{ progressText }}
              </ProgressBar>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
#mod-filetree-area,
#mod-update-area {
  --max-h: v-bind('bottomAreaheight');
  @apply max-h-(--max-h);
}
.prose h1 {
  font-size: 1.25em;
}
</style>
