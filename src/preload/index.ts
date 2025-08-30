import electron, { contextBridge, type IpcRendererEvent } from 'electron'
import type {
  IpcRenderer as ToolkitIpcRenderer,
  NodeProcess,
  WebFrame,
  WebUtils
} from '@electron-toolkit/preload'
import { exposeConf } from 'electron-conf/preload'

type IpcRendererListener = (event: IpcRendererEvent, ...args: any[]) => void

interface ExtendedIPCRenderer extends Omit<ToolkitIpcRenderer, 'sendTo'> {
  off(channel: string, listener: IpcRendererListener): this
  addListener(channel: string, listener: IpcRendererListener): this
  /**
   * @deprecated
   */
  sendTo(webContentsId: number, channel: string, ...args: any[]): void
}

const electronAPI: {
  ipcRenderer: ExtendedIPCRenderer
  webFrame: WebFrame
  webUtils: WebUtils
  process: NodeProcess
} = {
  ipcRenderer: {
    send(channel: string, ...args) {
      electron.ipcRenderer.send(channel, ...args)
    },
    sendSync(channel: string, ...args) {
      return electron.ipcRenderer.sendSync(channel, ...args)
    },
    sendToHost(channel: string, ...args) {
      electron.ipcRenderer.sendToHost(channel, ...args)
    },
    postMessage(channel: string, message, transfer) {
      electron.ipcRenderer.postMessage(channel, message, transfer)
    },
    invoke(channel: string, ...args) {
      return electron.ipcRenderer.invoke(channel, ...args)
    },
    on(channel: string, listener) {
      electron.ipcRenderer.on(channel, listener)
      return () => {
        electron.ipcRenderer.removeListener(channel, listener)
      }
    },
    off(channel: string, listener) {
      electron.ipcRenderer.off(channel, listener)
      return this
    },
    once(channel: string, listener) {
      electron.ipcRenderer.once(channel, listener)
      return () => {
        electron.ipcRenderer.removeListener(channel, listener)
      }
    },
    addListener(channel: string, listener) {
      electron.ipcRenderer.addListener(channel, listener)
      return this
    },
    removeListener(channel: string, listener: IpcRendererListener) {
      electron.ipcRenderer.removeListener(channel, listener)
      return this as unknown as ExtendedIPCRenderer
    },
    removeAllListeners(channel: string) {
      electron.ipcRenderer.removeAllListeners(channel)
    },
    sendTo(webContentsId: number, channel: string, ...args: any[]) {
      const electronVer = process.versions.electron
      const electronMajorVer = electronVer ? parseInt(electronVer.split('.')[0]) : 0
      if (electronMajorVer >= 28) {
        throw new Error('"sendTo" method has been removed since Electron 28.')
      } else {
        // @ts-expect-error
        electron.ipcRenderer.sendTo(webContentsId, channel, ...args)
      }
    }
  },
  webFrame: {
    insertCSS(css) {
      return electron.webFrame.insertCSS(css)
    },
    setZoomFactor(factor) {
      if (typeof factor === 'number' && factor > 0) {
        electron.webFrame.setZoomFactor(factor)
      }
    },
    setZoomLevel(level) {
      if (typeof level === 'number') {
        electron.webFrame.setZoomLevel(level)
      }
    }
  },
  webUtils: {
    getPathForFile(file) {
      return electron.webUtils.getPathForFile(file)
    }
  },
  process: {
    get platform() {
      return process.platform
    },
    get versions() {
      return process.versions
    },
    get env() {
      return { ...process.env }
    }
  }
}

exposeConf()

// Custom APIs for renderer
const api = {}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
