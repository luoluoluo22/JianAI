import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getProjectAssetsPath } from './app-state'

export const isDev = !app.isPackaged

function readLocalBackendDisabledMarker(): boolean {
  const markerValue = 'disabled-local-backend'

  try {
    const hashPath = isDev
      ? path.join(process.cwd(), 'python-deps-hash.txt')
      : path.join(process.resourcesPath, 'python-deps-hash.txt')
    if (!fs.existsSync(hashPath)) {
      return false
    }
    return fs.readFileSync(hashPath, 'utf-8').trim() === markerValue
  } catch {
    return false
  }
}

export const isLocalBackendDisabled = readLocalBackendDisabledMarker()

// Get directory - works in both CJS and ESM contexts
export function getCurrentDir(): string {
  // In bundled output, use app.getAppPath()
  if (!isDev) {
    return path.dirname(app.getPath('exe'))
  }
  // In development, use process.cwd() which is the project root
  return process.cwd()
}

export function getAllowedRoots(): string[] {
  const roots = [
    getCurrentDir(),
    app.getPath('userData'),
    app.getPath('downloads'),
    os.tmpdir(),
  ]
  if (!isDev && process.resourcesPath) {
    roots.push(process.resourcesPath)
  }
  roots.push(getProjectAssetsPath())
  return roots
}
