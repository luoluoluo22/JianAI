import { app, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { checkGPU } from '../gpu'
import { isPythonReady, downloadPythonEmbed } from '../python-setup'
import { getBackendHealthStatus, getBackendUrl, getAuthToken, getAdminToken, startPythonBackend } from '../python-backend'
import { getMainWindow } from '../window'
import { getAnalyticsState, setAnalyticsEnabled, sendAnalyticsEvent } from '../analytics'
import { isLocalBackendDisabled } from '../config'

function getModelsPath(): string {
  const modelsPath = path.join(app.getPath('userData'), 'models')
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true })
  }
  return modelsPath
}

function getRendererSettingsPath(): string {
  return path.join(app.getPath('userData'), 'renderer_settings.json')
}

function readRendererSettings(): Record<string, unknown> {
  const settingsPath = getRendererSettingsPath()
  try {
    if (!fs.existsSync(settingsPath)) {
      return {}
    }
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeRendererSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const settingsPath = getRendererSettingsPath()
  const nextValue = {
    ...readRendererSettings(),
    ...patch,
  }
  fs.writeFileSync(settingsPath, JSON.stringify(nextValue, null, 2), 'utf-8')
  return nextValue
}

function getSetupStatus(settingsPath: string): { needsSetup: boolean; needsLicense: boolean } {
  if (!fs.existsSync(settingsPath)) {
    return { needsSetup: true, needsLicense: true }
  }
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    return {
      needsSetup: !settings.setupComplete,
      needsLicense: !settings.licenseAccepted,
    }
  } catch {
    return { needsSetup: true, needsLicense: true }
  }
}

function markSetupComplete(settingsPath: string): void {
  let settings: Record<string, unknown> = {}

  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }
  } catch {
    settings = {}
  }

  settings.setupComplete = true
  settings.licenseAccepted = true
  settings.licenseAcceptedDate = new Date().toISOString()
  settings.setupDate = new Date().toISOString()

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

function markLicenseAccepted(settingsPath: string): void {
  let settings: Record<string, unknown> = {}

  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }
  } catch {
    settings = {}
  }

  settings.licenseAccepted = true
  settings.licenseAcceptedDate = new Date().toISOString()

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

export function registerAppHandlers(): void {
  ipcMain.handle('get-backend', () => {
    return { url: getBackendUrl() ?? '', token: getAuthToken() ?? '' }
  })

  ipcMain.handle('get-models-path', () => {
    return getModelsPath()
  })

  ipcMain.handle('check-gpu', async () => {
    return await checkGPU()
  })

  ipcMain.handle('get-app-info', () => {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      modelsPath: getModelsPath(),
      userDataPath: app.getPath('userData'),
      localBackendDisabled: isLocalBackendDisabled,
    }
  })

  ipcMain.handle('get-downloads-path', () => {
    return app.getPath('downloads')
  })

  ipcMain.handle('get-renderer-settings', () => {
    return readRendererSettings()
  })

  ipcMain.handle('save-renderer-settings', (_event, patch: Record<string, unknown>) => {
    return writeRendererSettings(patch)
  })

  ipcMain.handle('check-first-run', () => {
    if (isLocalBackendDisabled) {
      return { needsSetup: false, needsLicense: false }
    }
    const settingsPath = path.join(app.getPath('userData'), 'app_state.json')
    return getSetupStatus(settingsPath)
  })

  ipcMain.handle('accept-license', () => {
    const settingsPath = path.join(app.getPath('userData'), 'app_state.json')
    markLicenseAccepted(settingsPath)
    return true
  })

  ipcMain.handle('complete-setup', () => {
    const settingsPath = path.join(app.getPath('userData'), 'app_state.json')
    markSetupComplete(settingsPath)
    return true
  })

  ipcMain.handle('fetch-license-text', async () => {
    if (isLocalBackendDisabled) {
      return 'Local backend is disabled in this build. License acceptance for bundled local models is not required.'
    }
    const resp = await fetch('https://huggingface.co/Lightricks/LTX-2.3/raw/main/LICENSE')
    if (!resp.ok) {
      throw new Error(`Failed to fetch license (HTTP ${resp.status})`)
    }
    return await resp.text()
  })

  ipcMain.handle('get-notices-text', async () => {
    const noticesPath = path.join(app.getAppPath(), 'NOTICES.md')
    return fs.readFileSync(noticesPath, 'utf-8')
  })

  ipcMain.handle('get-resource-path', () => {
    if (!app.isPackaged) {
      return null
    }
    return process.resourcesPath
  })

  ipcMain.handle('check-python-ready', () => {
    if (isLocalBackendDisabled) {
      return { ready: true }
    }
    return isPythonReady()
  })

  ipcMain.handle('start-python-setup', async () => {
    if (isLocalBackendDisabled) {
      return
    }
    await downloadPythonEmbed((progress) => {
      getMainWindow()?.webContents.send('python-setup-progress', progress)
    })
  })

  ipcMain.handle('start-python-backend', async () => {
    if (isLocalBackendDisabled) {
      return
    }
    await startPythonBackend()
  })

  ipcMain.handle('get-backend-health-status', () => {
    return getBackendHealthStatus()
  })

  ipcMain.handle('get-analytics-state', () => {
    return getAnalyticsState()
  })

  ipcMain.handle('set-analytics-enabled', (_event, enabled: boolean) => {
    setAnalyticsEnabled(enabled)
  })

  ipcMain.handle('send-analytics-event', async (_event, eventName: string, extraDetails?: Record<string, unknown> | null) => {
    await sendAnalyticsEvent(eventName, extraDetails)
  })

  ipcMain.handle('open-models-dir-change-dialog', async () => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return { success: false, error: 'No window' }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Models Directory',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths.length) return { success: false, error: 'cancelled' }

    const newDir = result.filePaths[0]
    const url = getBackendUrl()
    const auth = getAuthToken()
    const admin = getAdminToken()
    if (!url || !auth || !admin) return { success: false, error: 'Backend not ready' }

    const resp = await fetch(`${url}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth}`,
        'X-Admin-Token': admin,
      },
      body: JSON.stringify({ modelsDir: newDir }),
    })
    if (!resp.ok) return { success: false, error: await resp.text() }

    return { success: true, path: newDir }
  })

}
