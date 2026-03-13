import './app-paths'
import { app } from 'electron'
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

appendBootLog('main:start')
const gotLock = app.requestSingleInstanceLock()
appendBootLog(`main:gotLock=${gotLock}`)

if (!gotLock) {
  appendBootLog('main:quit-no-lock')
  app.quit()
} else {
  appendBootLog('main:register-handlers')
  initSessionLog()
  logAppVersion()

  registerAppHandlers()
  registerFileHandlers()
  registerLogHandlers()
  registerExportHandlers()
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
