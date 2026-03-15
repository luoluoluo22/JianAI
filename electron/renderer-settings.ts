import { app } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export interface ExternalControlSettings {
  enabled: boolean
  port: number
  token: string
}

function getRendererSettingsPath(): string {
  return path.join(app.getPath('userData'), 'renderer_settings.json')
}

export function readRendererSettings(): Record<string, unknown> {
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

export function writeRendererSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const settingsPath = getRendererSettingsPath()
  const nextValue = {
    ...readRendererSettings(),
    ...patch,
  }
  fs.writeFileSync(settingsPath, JSON.stringify(nextValue, null, 2), 'utf-8')
  return nextValue
}

export function ensureExternalControlSettings(): ExternalControlSettings {
  const settings = readRendererSettings()
  const raw = settings.externalControl
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const nextValue: ExternalControlSettings = {
    enabled: record.enabled !== false,
    port: typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port < 65536
      ? record.port
      : 47821,
    token: typeof record.token === 'string' && record.token.trim().length >= 16
      ? record.token.trim()
      : crypto.randomBytes(24).toString('hex'),
  }

  if (
    record.enabled !== nextValue.enabled ||
    record.port !== nextValue.port ||
    record.token !== nextValue.token
  ) {
    writeRendererSettings({
      externalControl: nextValue,
    })
  }

  return nextValue
}
