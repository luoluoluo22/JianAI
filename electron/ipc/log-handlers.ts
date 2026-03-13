import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLogDir, getCurrentLogFilename } from '../logging-management'
import { logger, writeLog } from '../logger'

const VALID_LOG_LEVELS = new Set(['INFO', 'WARNING', 'ERROR', 'DEBUG'])

function getEditingAgentDebugLogPath(): string {
  return path.join(getLogDir(), 'editing-agent-debug.jsonl')
}

export function registerLogHandlers(): void {
  ipcMain.handle('write-log', async (_event, level: string, message: string) => {
    const upperLevel = String(level).toUpperCase()
    if (!VALID_LOG_LEVELS.has(upperLevel)) return
    writeLog(upperLevel as 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG', 'Renderer', String(message))
  })
  ipcMain.handle('get-logs', async () => {
    try {
      const logPath = getCurrentLogFilename()
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8')
        const allLines = content.split('\n')
        const lines = allLines.slice(-200).map(l => l.trimEnd())
        return { logPath, lines }
      }
      return { logPath, lines: [] }
    } catch (error) {
      logger.error(`Error getting logs: ${error}`)
      return { logPath: '', lines: [], error: String(error) }
    }
  })

  ipcMain.handle('get-log-path', async () => {
    const logPath = getCurrentLogFilename()
    const logDir = getLogDir()
    return { logPath, logDir }
  })

  ipcMain.handle('append-agent-debug-log', async (_event, line: string) => {
    const logDir = getLogDir()
    fs.mkdirSync(logDir, { recursive: true })
    fs.appendFileSync(getEditingAgentDebugLogPath(), `${String(line).trimEnd()}\n`, 'utf-8')
  })

  ipcMain.handle('get-agent-debug-log', async () => {
    try {
      const logPath = getEditingAgentDebugLogPath()
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf-8')
        const allLines = content.split('\n').filter(Boolean)
        const lines = allLines.slice(-400)
        return { logPath, lines }
      }
      return { logPath, lines: [] }
    } catch (error) {
      logger.error(`Error getting editing agent debug logs: ${error}`)
      return { logPath: getEditingAgentDebugLogPath(), lines: [], error: String(error) }
    }
  })

  ipcMain.handle('open-log-folder', async () => {
    const logDir = getLogDir()
    if (fs.existsSync(logDir)) {
      const { shell } = await import('electron')
      shell.openPath(logDir)
      return true
    }
    return false
  })
}
