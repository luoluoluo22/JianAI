import './app-paths'
import { app, Menu, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { setupCSP } from './csp'
import { registerExportHandlers } from './export/export-handler'
import { stopExportProcess } from './export/ffmpeg-utils'
import { registerAppHandlers } from './ipc/app-handlers'
import { registerFileHandlers } from './ipc/file-handlers'
import { registerLogHandlers } from './ipc/log-handlers'
import { registerVideoProcessingHandlers } from './ipc/video-processing-handlers'
import { initSessionLog } from './logging-management'
import { stopPythonBackend } from './python-backend'
import { initAutoUpdater } from './updater'
import { createWindow, getMainWindow } from './window'
import { sendAnalyticsEvent } from './analytics'

function appendBootLog(message: string): void {
  try {
    const baseDir = path.dirname(process.execPath)
    fs.appendFileSync(path.join(baseDir, 'boot.log'), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Best effort only.
  }
}

function logAppVersion(): void {
  if (!app.isPackaged) {
    console.log('[JianAI] Running in development mode')
  } else {
    console.log(`[JianAI] Version ${app.getVersion()}`)
  }
}

function installAppMenu(): void {
  const template = [
    {
      label: '文件',
      submenu: [
        { role: 'close', label: '关闭窗口' },
        { type: 'separator' },
        { role: 'quit', label: '退出剪艾 JianAI' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'JianAI GitHub',
          click: () => { void shell.openExternal('https://github.com/luoluoluo22/JianAI') },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template as any))
}

appendBootLog('main:start')
process.on('uncaughtException', (error) => {
  appendBootLog(`main:uncaughtException ${error instanceof Error ? error.stack || error.message : String(error)}`)
})
process.on('unhandledRejection', (reason) => {
  appendBootLog(`main:unhandledRejection ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`)
})
const gotLock = app.requestSingleInstanceLock()
appendBootLog(`main:gotLock=${gotLock}`)

if (!gotLock) {
  appendBootLog('main:quit-no-lock')
  app.quit()
} else {
  appendBootLog('main:register-handlers')
  initSessionLog()
  logAppVersion()
  appendBootLog('main:registerAppHandlers')
  registerAppHandlers()
  appendBootLog('main:registerFileHandlers')
  registerFileHandlers()
  appendBootLog('main:registerLogHandlers')
  registerLogHandlers()
  appendBootLog('main:registerExportHandlers')
  registerExportHandlers()
  appendBootLog('main:registerVideoProcessingHandlers')
  registerVideoProcessingHandlers()

  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
      return
    }
    if (app.isReady()) {
      createWindow()
    }
  })

  app.whenReady().then(async () => {
    appendBootLog('main:whenReady')
    setupCSP()
    installAppMenu()
    appendBootLog('main:createWindow')
    createWindow()
    initAutoUpdater()
    // Python setup + backend start are now driven by the renderer via IPC

    // Fire analytics event (no-op if user hasn't opted in)
    void sendAnalyticsEvent('ltxdesktop_app_launched')
  })

  app.on('window-all-closed', () => {
    appendBootLog('main:window-all-closed')
    if (process.platform !== 'darwin') {
      stopPythonBackend()
      app.quit()
    }
  })

  app.on('activate', () => {
    appendBootLog('main:activate')
    if (getMainWindow() === null) {
      createWindow()
    }
  })

  app.on('before-quit', () => {
    appendBootLog('main:before-quit')
    stopExportProcess()
    stopPythonBackend()
  })
}
