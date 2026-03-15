import http from 'http'
import type { AddressInfo } from 'net'
import { logger } from './logger'
import { ensureExternalControlSettings, type ExternalControlSettings } from './renderer-settings'
import { getMainWindow } from './window'

interface ExternalAgentState {
  available: boolean
  currentProjectId: string | null
  isRunning: boolean
  llmEnabled: boolean
  model: string
  messageCount: number
}

interface ExternalAgentCommandResult {
  success: boolean
  projectId: string | null
  userText: string
  assistantText: string
  provider: 'llm' | 'rule' | 'unknown'
  actionCount: number
  referencedClipIds: string[]
  error?: string
  timestamp: string
}

let server: http.Server | null = null
let activeSettings: ExternalControlSettings | null = null

function jsonResponse(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function extractToken(req: http.IncomingMessage): string | null {
  const bearer = req.headers.authorization
  if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
    return bearer.slice('Bearer '.length).trim()
  }
  const headerToken = req.headers['x-jianai-token']
  if (typeof headerToken === 'string') {
    return headerToken.trim()
  }
  return null
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

async function callRendererBridge<T>(method: 'runCommand' | 'getState', payload?: unknown): Promise<T> {
  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }

  const methodLiteral = JSON.stringify(method)
  const payloadLiteral = payload === undefined ? 'undefined' : JSON.stringify(payload)
  const script = `(async () => {
    const bridge = window.__JIANAI_EXTERNAL_AGENT__;
    const methodName = ${methodLiteral};
    if (!bridge || typeof bridge[methodName] !== 'function') {
      throw new Error('External agent bridge is unavailable in the renderer');
    }
    return await bridge[methodName](${payloadLiteral});
  })()`

  return await mainWindow.webContents.executeJavaScript(script, true) as T
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/health') {
    jsonResponse(res, 200, {
      ok: true,
      service: 'jianai-external-control',
      port: activeSettings?.port ?? null,
      enabled: activeSettings?.enabled ?? false,
    })
    return
  }

  const token = extractToken(req)
  if (!activeSettings || token !== activeSettings.token) {
    jsonResponse(res, 401, {
      ok: false,
      error: 'Unauthorized',
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const state = await callRendererBridge<ExternalAgentState>('getState')
    jsonResponse(res, 200, {
      ok: true,
      state,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/agent/chat') {
    const rawBody = await readBody(req)
    let parsed: { input?: unknown } = {}
    try {
      parsed = rawBody.trim() ? JSON.parse(rawBody) as { input?: unknown } : {}
    } catch {
      jsonResponse(res, 400, { ok: false, error: 'Invalid JSON body' })
      return
    }

    const input = typeof parsed.input === 'string' ? parsed.input.trim() : ''
    if (!input) {
      jsonResponse(res, 400, { ok: false, error: 'Field "input" is required' })
      return
    }

    const result = await callRendererBridge<ExternalAgentCommandResult>('runCommand', input)
    jsonResponse(res, result.success ? 200 : 409, {
      ok: result.success,
      result,
    })
    return
  }

  jsonResponse(res, 404, {
    ok: false,
    error: 'Not found',
  })
}

export function startExternalControlServer(): void {
  activeSettings = ensureExternalControlSettings()
  if (!activeSettings.enabled) {
    logger.info('[external-control] disabled by renderer settings')
    return
  }
  if (server) {
    return
  }

  server = http.createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      logger.error(`[external-control] request failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
      jsonResponse(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown server error',
      })
    })
  })

  server.listen(activeSettings.port, '127.0.0.1', () => {
    const address = server?.address() as AddressInfo | null
    logger.info(`[external-control] listening on http://127.0.0.1:${address?.port ?? activeSettings?.port ?? 0}`)
  })
  server.on('error', (error) => {
    logger.error(`[external-control] server error: ${error instanceof Error ? error.stack || error.message : String(error)}`)
  })
}

export async function stopExternalControlServer(): Promise<void> {
  if (!server) {
    return
  }
  const current = server
  server = null
  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
  logger.info('[external-control] stopped')
}

export function getExternalControlSettings(): ExternalControlSettings {
  return activeSettings ?? ensureExternalControlSettings()
}
