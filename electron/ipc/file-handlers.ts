import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { getAllowedRoots } from '../config'
import { logger } from '../logger'
import { getMainWindow } from '../window'
import { validatePath, approvePath } from '../path-validation'
import { getProjectAssetsPath, setProjectAssetsPath } from '../app-state'
import { renderHtmlToVideoWithChromium } from '../html-render/chromium-renderer'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
}

type HtmlAssetResult =
  | { success: true; mediaType: 'image'; path: string; url: string; htmlPath: string; width: number; height: number }
  | { success: true; mediaType: 'video'; path: string; url: string; htmlPath: string; thumbnailPath: string; thumbnailUrl: string; width: number; height: number }
  | { success: false; error: string }

function readLocalFileAsBase64(filePath: string): { data: string; mimeType: string } {
  const data = fs.readFileSync(filePath)
  const base64 = data.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  return { data: base64, mimeType }
}

function searchDirectoryForFiles(dir: string, filenames: string[]): Record<string, string> {
  const results: Record<string, string> = {}
  const remaining = new Set(filenames.map(f => f.toLowerCase()))

  const walk = (currentDir: string, depth: number) => {
    if (remaining.size === 0 || depth > 10) return // max depth to avoid infinite loops
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (remaining.size === 0) break
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          if (remaining.has(lower)) {
            results[lower] = fullPath
            remaining.delete(lower)
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1)
        }
      }
    } catch {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  walk(dir, 0)
  return results
}

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

function sanitizeBaseName(name: string): string {
  const trimmed = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ')
  return trimmed || 'html-asset'
}

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized.includes('png')) return '.png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg'
  if (normalized.includes('webp')) return '.webp'
  if (normalized.includes('gif')) return '.gif'
  return '.png'
}

function normalizeRemoteImageUrl(source: string): string {
  return source.trim().replace(/\\&/g, '&').replace(/&amp;/gi, '&')
}

async function downloadRemoteImage(source: string): Promise<{ buffer: Buffer; contentType: string }> {
  const normalizedSource = normalizeRemoteImageUrl(source)
  const target = new URL(normalizedSource)
  const client = target.protocol === 'http:' ? http : https

  return await new Promise((resolve, reject) => {
    const request = client.get(normalizedSource, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) JianAI/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.doubao.com/',
      },
    }, (response) => {
      const statusCode = response.statusCode ?? 0
      const location = response.headers.location
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume()
        const redirectedUrl = new URL(location, normalizedSource).toString()
        downloadRemoteImage(redirectedUrl).then(resolve).catch(reject)
        return
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume()
        reject(new Error(`Image fetch failed with status ${statusCode}.`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      response.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: response.headers['content-type'] ?? 'image/png',
        })
      })
      response.on('error', reject)
    })

    request.on('error', reject)
  })
}

async function importImageAsset(
  projectId: string,
  payload: { source: string; name?: string },
): Promise<{ success: true; path: string; url: string } | { success: false; error: string }> {
  const source = payload.source.trim()
  if (!projectId.trim() || !source) {
    return { success: false, error: 'Missing image import parameters.' }
  }

  const assetsRoot = getProjectAssetsPath()
  const destDir = path.join(assetsRoot, projectId)
  fs.mkdirSync(destDir, { recursive: true })
  const baseName = sanitizeBaseName(payload.name || 'imported-image')
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  try {
    if (/^data:image\//i.test(source)) {
      const match = source.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i)
      if (!match) {
        return { success: false, error: 'Unsupported data URI image format.' }
      }
      const ext = mimeTypeToExtension(match[1])
      const destPath = path.join(destDir, `${baseName}-${stamp}${ext}`)
      fs.writeFileSync(destPath, Buffer.from(match[2], 'base64'))
      return { success: true, path: destPath, url: pathToFileUrl(destPath) }
    }

    if (/^https?:\/\//i.test(source)) {
      const normalizedSource = normalizeRemoteImageUrl(source)
      const { buffer, contentType } = await downloadRemoteImage(normalizedSource)
      const extFromUrl = path.extname(new URL(normalizedSource).pathname)
      const ext = extFromUrl || mimeTypeToExtension(contentType)
      const destPath = path.join(destDir, `${baseName}-${stamp}${ext}`)
      fs.writeFileSync(destPath, buffer)
      return { success: true, path: destPath, url: pathToFileUrl(destPath) }
    }

    const resolvedSrc = validatePath(source, getAllowedRoots())
    const ext = path.extname(resolvedSrc) || '.png'
    const destPath = path.join(destDir, `${baseName}-${stamp}${ext}`)
    fs.copyFileSync(resolvedSrc, destPath)
    return { success: true, path: destPath, url: pathToFileUrl(destPath) }
  } catch (error) {
    logger.error(`[image-import] failed: ${source} ${error}`)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function wrapHtmlDocument(html: string, width: number, height: number): string {
  if (/<html[\s>]/i.test(html) || /<!doctype/i.test(html)) {
    return html
  }

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #ffffff;
        color-scheme: light;
      }
      body {
        position: relative;
      }
    </style>
  </head>
  <body>${html}</body>
</html>`
}

async function ensureHtmlCaptureBackground(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    (() => {
      const isTransparent = (value) => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
      const htmlStyle = getComputedStyle(document.documentElement)
      const bodyStyle = getComputedStyle(document.body)
      document.documentElement.style.width = '100%'
      document.documentElement.style.height = '100%'
      document.body.style.width = '100%'
      document.body.style.height = '100%'
      document.body.style.minHeight = '100vh'
      if (!document.body.style.margin) {
        document.body.style.margin = '0'
      }
      document.querySelectorAll('canvas').forEach((node) => {
        node.style.display = 'block'
        node.style.width = '100vw'
        node.style.height = '100vh'
      })
      document.querySelectorAll('svg').forEach((node) => {
        if (!node.getAttribute('width')) {
          node.setAttribute('width', String(window.innerWidth))
        }
        if (!node.getAttribute('height')) {
          node.setAttribute('height', String(window.innerHeight))
        }
        node.style.display = 'block'
      })
      if (isTransparent(htmlStyle.backgroundColor)) {
        document.documentElement.style.background = '#ffffff'
      }
      if (isTransparent(bodyStyle.backgroundColor)) {
        document.body.style.background = '#ffffff'
      }
      document.documentElement.style.colorScheme = 'light'
    })()
  `, true)
}

async function waitForHtmlRender(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        requestAnimationFrame(() => requestAnimationFrame(() => {
          setTimeout(() => resolve(true), 350)
        }))
      }
      const timeout = setTimeout(finish, 3000)
      const fontReady = document.fonts?.ready ?? Promise.resolve()
      const imageReady = Array.from(document.images || []).map((img) => (
        img.complete
          ? Promise.resolve()
          : new Promise((done) => {
              img.addEventListener('load', done, { once: true })
              img.addEventListener('error', done, { once: true })
            })
      ))
      Promise.all([fontReady, ...imageReady])
        .then(() => {
          clearTimeout(timeout)
          finish()
        })
        .catch(() => {
          clearTimeout(timeout)
          finish()
        })
    })
  `, true)
}

function createHtmlRenderWindow(width: number, height: number, offscreen = false): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen,
    },
  })
}

function shouldRenderHtmlAsVideo(html: string): boolean {
  const lower = html.toLowerCase()
  return (
    lower.includes('<script') ||
    lower.includes('<canvas') ||
    lower.includes('requestanimationframe') ||
    lower.includes('setinterval(') ||
    lower.includes('@keyframes') ||
    lower.includes('animation:')
  )
}

async function createHtmlAssetVideo(
  htmlPath: string,
  destDir: string,
  baseName: string,
  width: number,
  height: number,
  durationSeconds: number,
): Promise<{ success: true; path: string; url: string; thumbnailPath: string; thumbnailUrl: string; width: number; height: number } | { success: false; error: string }> {
  return renderHtmlToVideoWithChromium(htmlPath, destDir, baseName, width, height, durationSeconds)
}

async function createHtmlAssetImage(
  projectId: string,
  payload: {
    html: string
    width: number
    height: number
    name: string
    duration?: number
  },
  outputRootOverride?: string,
): Promise<HtmlAssetResult> {
  const width = Math.max(64, Math.min(4096, Math.round(payload.width)))
  const height = Math.max(64, Math.min(4096, Math.round(payload.height)))
  const html = payload.html.trim()
  const name = sanitizeBaseName(payload.name || 'html-asset')
  const durationSeconds = Math.max(1, Math.min(15, payload.duration ?? 5))

  if (!projectId.trim()) {
    return { success: false, error: 'Missing projectId.' }
  }
  if (!html) {
    return { success: false, error: 'HTML content is empty.' }
  }
  if (html.length > 120_000) {
    return { success: false, error: 'HTML content is too large.' }
  }

  const assetsRoot = outputRootOverride || getProjectAssetsPath()
  const destDir = path.join(assetsRoot, projectId)
  fs.mkdirSync(destDir, { recursive: true })

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const baseName = `${name}-${stamp}`
  const pngPath = path.join(destDir, `${baseName}.png`)
  const htmlPath = path.join(destDir, `${baseName}.html`)
  const documentHtml = wrapHtmlDocument(html, width, height)

  let renderWindow: BrowserWindow | null = null

  try {
    renderWindow = createHtmlRenderWindow(width, height)

    await renderWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`)
    await ensureHtmlCaptureBackground(renderWindow)
    await waitForHtmlRender(renderWindow)
    fs.writeFileSync(htmlPath, documentHtml, 'utf-8')

    if (shouldRenderHtmlAsVideo(documentHtml)) {
      renderWindow.destroy()
      renderWindow = null
      const videoResult = await createHtmlAssetVideo(htmlPath, destDir, baseName, width, height, durationSeconds)
      if (!videoResult.success) {
        return videoResult
      }
      return {
        success: true,
        mediaType: 'video',
        path: videoResult.path,
        url: videoResult.url,
        htmlPath,
        thumbnailPath: videoResult.thumbnailPath,
        thumbnailUrl: videoResult.thumbnailUrl,
        width,
        height,
      }
    }

    const image = await renderWindow.webContents.capturePage({ x: 0, y: 0, width, height })
    fs.writeFileSync(pngPath, image.toPNG())

    return {
      success: true,
      mediaType: 'image',
      path: pngPath,
      url: pathToFileUrl(pngPath),
      htmlPath,
      width,
      height,
    }
  } catch (error) {
    logger.error(`[html-asset] failed: ${error}`)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (renderWindow && !renderWindow.isDestroyed()) {
      renderWindow.destroy()
    }
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle('open-ltx-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://console.ltx.video/api-keys/')
    return true
  })

  ipcMain.handle('open-cloudflare-api-token-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://dash.cloudflare.com/profile/api-tokens')
    return true
  })

  ipcMain.handle('open-parent-folder-of-file', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    const parentDir = path.dirname(normalizedPath)
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(`Parent directory not found: ${parentDir}`)
    }
    shell.openPath(parentDir)
  })

  ipcMain.handle('show-item-in-folder', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('read-local-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = validatePath(filePath, getAllowedRoots())

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`File not found: ${normalizedPath}`)
      }

      return readLocalFileAsBase64(normalizedPath)
    } catch (error) {
      logger.error( `Error reading local file: ${error}`)
      throw error
    }
  })

  ipcMain.handle('show-save-dialog', async (_event, options: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options.title || 'Save File',
      defaultPath: options.defaultPath,
      filters: options.filters || [],
    })
    if (result.canceled || !result.filePath) return null
    approvePath(result.filePath)
    return result.filePath
  })

  ipcMain.handle('save-file', async (_event, filePath: string, data: string, encoding?: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
      } else {
        fs.writeFileSync(filePath, data, 'utf-8')
      }
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('save-binary-file', async (_event, filePath: string, data: ArrayBuffer) => {
    try {
      validatePath(filePath, getAllowedRoots())
      fs.writeFileSync(filePath, Buffer.from(data))
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving binary file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('generate-cloudflare-image', async (
    _event,
    payload: {
      accountId: string
      apiToken: string
      model: string
      prompt: string
      width: number
      height: number
      steps: number
      guidance?: number
      seed?: number
    },
  ): Promise<{ success: true; data: ArrayBuffer } | { success: false; error: string }> => {
    const accountId = payload.accountId.trim()
    const apiToken = payload.apiToken.trim()
    const model = payload.model.trim()

    if (!accountId || !apiToken || !model || !payload.prompt.trim()) {
      return { success: false, error: 'Missing Cloudflare image generation parameters.' }
    }

    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`
    logger.info(`[cloudflare-image-ipc] request model=${model} size=${payload.width}x${payload.height} steps=${payload.steps} promptLength=${payload.prompt.length}`)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: payload.prompt,
          width: payload.width,
          height: payload.height,
          steps: payload.steps,
          guidance: payload.guidance ?? 4.5,
          seed: payload.seed,
        }),
      })

      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? ''
        let detail = ''
        if (contentType.includes('application/json')) {
          const errorPayload = await response.json() as {
            errors?: Array<{ message?: string }>
            result?: { error?: string }
            message?: string
          }
          detail =
            errorPayload.errors?.[0]?.message ||
            errorPayload.result?.error ||
            errorPayload.message ||
            ''
        } else {
          detail = await response.text()
        }
        logger.error(`[cloudflare-image-ipc] bad response status=${response.status} model=${model} detail=${detail || 'empty-body'}`)
        return { success: false, error: detail || `Cloudflare image request failed with status ${response.status}.` }
      }

      const contentType = response.headers.get('content-type') ?? ''
      let data: ArrayBuffer

      if (contentType.includes('application/json')) {
        const successPayload = await response.json() as {
          result?: { image?: string }
          image?: string
          errors?: Array<{ message?: string }>
          message?: string
        }
        const detail =
          successPayload.errors?.[0]?.message ||
          successPayload.message ||
          ''
        if (detail) {
          logger.error(`[cloudflare-image-ipc] json error model=${model} detail=${detail}`)
          return { success: false, error: detail }
        }
        const encodedImage = successPayload.result?.image ?? successPayload.image
        if (!encodedImage) {
          return { success: false, error: 'Cloudflare image response did not contain image data.' }
        }
        const decoded = Buffer.from(encodedImage, 'base64')
        data = decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength)
      } else {
        data = await response.arrayBuffer()
      }

      logger.info(`[cloudflare-image-ipc] response ok status=${response.status} model=${model}`)
      return { success: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[cloudflare-image-ipc] request failed model=${model} error=${message}`)
      return { success: false, error: `Cloudflare request failed: ${message}` }
    }
  })

  ipcMain.handle('show-open-directory-dialog', async (_event, options: { title?: string }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approvePath(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('search-directory-for-files', async (_event, dir: string, filenames: string[]) => {
    return searchDirectoryForFiles(dir, filenames)
  })

  ipcMain.handle('copy-to-project-assets', async (_event, srcPath: string, projectId: string) => {
    try {
      const resolvedSrc = validatePath(srcPath, getAllowedRoots())
      const assetsRoot = getProjectAssetsPath()
      const destDir = path.join(assetsRoot, projectId)
      fs.mkdirSync(destDir, { recursive: true })
      const fileName = path.basename(resolvedSrc)
      const destPath = path.join(destDir, fileName)
      fs.copyFileSync(resolvedSrc, destPath)
      const normalized = destPath.replace(/\\/g, '/')
      const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
      return { success: true, path: destPath, url: fileUrl }
    } catch (error) {
      logger.error(`Error copying to project assets: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-project-assets-path', async () => {
    return getProjectAssetsPath()
  })

  ipcMain.handle('create-html-asset', async (
    _event,
    projectId: string,
    payload: {
      html: string
      width: number
      height: number
      name: string
    },
  ) => {
    return createHtmlAssetImage(projectId, payload)
  })

  ipcMain.handle('import-image-to-project-assets', async (
    _event,
    projectId: string,
    payload: { source: string; name?: string },
  ) => {
    return importImageAsset(projectId, payload)
  })

  ipcMain.handle('open-project-assets-path-change-dialog', async () => {
    try {
      const mainWindow = getMainWindow()
      if (!mainWindow) return { success: false, error: 'No window' }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Project Assets Path',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'cancelled' }
      const selectedPath = path.resolve(result.filePaths[0])
      setProjectAssetsPath(selectedPath)
      approvePath(selectedPath)
      return { success: true, path: selectedPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('check-files-exist', async (_event, filePaths: string[]) => {
    const results: Record<string, boolean> = {}
    for (const p of filePaths) {
      try {
        results[p] = fs.existsSync(p)
      } catch {
        results[p] = false
      }
    }
    return results
  })

  ipcMain.handle('show-open-file-dialog', async (_event, options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: string[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const props: any[] = ['openFile']
    if (options.properties?.includes('multiSelections')) props.push('multiSelections')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select File',
      filters: options.filters || [],
      properties: props,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    for (const fp of result.filePaths) {
      approvePath(fp)
    }
    return result.filePaths
  })

}
