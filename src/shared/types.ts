import type { Entry } from '@zip.js/zip.js'
import type { TreeNode } from 'primevue/treenode'

export interface PositionSetting {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export interface AppSettings {
  APIKey: string
  instanceLocation: string
  position: PositionSetting
  fetchCache: Record<string, any>
}

export interface UpdateFile {
  name: string
  filename: string
  oldFilename?: string
  addonID: number
  fileID: number
  changelog?: string
  downloadUrl?: string
  required: boolean
}

export interface TreeNodeEntry extends TreeNode {
  entry: Entry
  isFile: boolean
  content?: string
  children?: TreeNodeEntry[]
}

export type FlattenedEntry = Entry & {
  key: string
  content?: string
  isFile: boolean
}

export interface UpdateModpackData {
  overrides: FlattenedEntry[]
  overridesTotal: number
  newAddons: UpdateFile[]
  changedAddons: UpdateFile[]
  disabledAddons: UpdateFile[]
  removedAddons: UpdateFile[]
}
