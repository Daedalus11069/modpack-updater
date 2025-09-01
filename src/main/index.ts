import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { readFile, rename, unlink } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { Conf, type JSONSchema } from 'electron-conf/main'
import { writeFile } from 'write-file-safe'
import { AppSettings, PositionSetting, UpdateModpackData } from './../shared/types'
import icon from '../../resources/icon.png?asset'
import { downloadFile } from 'ipull'

const schema: JSONSchema<AppSettings> = {
  type: 'object',
  properties: {
    APIKey: {
      type: 'string'
    },
    instanceLocation: {
      type: 'string'
    },
    position: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        maximized: { type: 'boolean' }
      },
      required: []
    },
    fetchCache: {
      type: 'object'
    }
  },
  required: []
}

const store = new Conf({ schema })

store.registerRendererListener()

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()

    mainWindow.setBounds(store.get('position'))
    if (store.get('position.maximized')) {
      mainWindow.maximize()
    }
    mainWindow.on('maximize', () => {
      store.set('position.maximized', true)
    })
    mainWindow.on('unmaximize', () => {
      store.set('position.maximized', false)
    })
    mainWindow.on('resize', () => {
      const bounds = mainWindow.getBounds() as PositionSetting
      bounds.maximized = mainWindow.isMaximized()
      store.set('position', bounds)
    })
    mainWindow.on('move', () => {
      const bounds = mainWindow.getBounds() as PositionSetting
      bounds.maximized = mainWindow.isMaximized()
      store.set('position', bounds)
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.daedalus11069')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  const mainWindow = createWindow()

  ipcMain.handle('choose-folder', () => {
    const folders = dialog.showOpenDialogSync(mainWindow, {
      properties: ['openDirectory']
    })
    if (typeof folders !== 'undefined' && folders.length > 0) {
      return folders[0]
    }
    return ''
  })

  ipcMain.handle('get-instance-json', async () => {
    const instanceLocation = store.get('instanceLocation')
    if (
      typeof instanceLocation !== 'undefined' &&
      instanceLocation !== null &&
      instanceLocation !== ''
    ) {
      return JSON.parse(
        await readFile(join(instanceLocation, 'minecraftinstance.json'), { encoding: 'utf-8' })
      )
    }
    throw new Error('No Instance Defined')
  })

  ipcMain.handle('update-modpack', async (evt, data: UpdateModpackData) => {
    const { overrides, overridesTotal, newAddons, changedAddons, disabledAddons, removedAddons } =
      data
    const totalItems =
      overridesTotal +
      newAddons.length +
      changedAddons.length +
      disabledAddons.length +
      removedAddons.length
    const instanceLocation = store.get('instanceLocation')

    if (
      typeof instanceLocation !== 'undefined' &&
      instanceLocation !== null &&
      instanceLocation !== ''
    ) {
      let idx = 0
      for await (const newAddon of newAddons) {
        if (typeof newAddon.downloadUrl !== 'undefined') {
          const downloader = await downloadFile({
            url: newAddon.downloadUrl!,
            directory: join(instanceLocation, 'mods'), // or 'savePath' for full path
            cliProgress: false, // Show progress bar in the CLI (default: false)
            parallelStreams: 1 // Number of parallel connections (default: 3)
          })
          await downloader.download()
          evt.sender.send('update-modpack-progress', (idx++ / totalItems) * 100)
        }
      }

      for await (const changedAddon of changedAddons) {
        if (
          typeof changedAddon.downloadUrl !== 'undefined' &&
          typeof changedAddon.oldFilename !== 'undefined'
        ) {
          await unlink(join(instanceLocation, 'mods', changedAddon.oldFilename!))
          const downloader = await downloadFile({
            url: changedAddon.downloadUrl!,
            directory: join(instanceLocation, 'mods'), // or 'savePath' for full path
            fileName: changedAddon.filename,
            cliProgress: false, // Show progress bar in the CLI (default: false)
            parallelStreams: 1 // Number of parallel connections (default: 3)
          })
          await downloader.download()
          evt.sender.send('update-modpack-progress', (idx++ / totalItems) * 100)
        }
      }

      for await (const disabledAddon of disabledAddons) {
        try {
          await rename(
            join(instanceLocation, 'mods', disabledAddon.filename),
            join(instanceLocation, 'mods', disabledAddon.filename + '.disabled')
          )
        } catch (e) {
          console.log(e)
        }
        evt.sender.send('update-modpack-progress', (idx++ / totalItems) * 100)
      }

      for await (const removedAddon of removedAddons) {
        await unlink(join(instanceLocation, 'mods', removedAddon.filename))
        evt.sender.send('update-modpack-progress', (idx++ / totalItems) * 100)
      }

      for await (const override of overrides) {
        try {
          if (typeof override.content !== 'undefined') {
            let content: string | Buffer = override.content
            if (
              override.key.slice((Math.max(0, override.key.lastIndexOf('.')) || Infinity) + 1) !==
              ''
            ) {
              content = Buffer.from(content.replace(/^data:(.*?);base64,/, ''), 'base64')
            }
            const successful = await writeFile(
              join(instanceLocation, override.key.replace(/^overrides\//i, '')),
              content,
              {
                appendNewline: false
              }
            )
            if (successful) {
              evt.sender.send('update-modpack-progress', (idx++ / totalItems) * 100)
            }
          }
        } catch (e) {
          console.log(e)
        }
      }
    }
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
