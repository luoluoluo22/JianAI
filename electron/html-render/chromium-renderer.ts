import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { logger } from '../logger'
import { findFfmpegPath, runFfmpeg } from '../export/ffmpeg-utils'

function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

export function findChromiumExecutable(): string | null {
  const envPath = process.env.JIANAI_CHROMIUM_PATH?.trim()
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  const bundledCandidates = [
    path.join(process.resourcesPath, 'ms-playwright', 'chromium-1169', 'chrome-win', 'chrome.exe'),
    path.join(process.resourcesPath, 'ms-playwright', 'chromium-1161', 'chrome-win', 'chrome.exe'),
    path.join(process.resourcesPath, 'ms-playwright', 'chromium-1148', 'chrome-win', 'chrome.exe'),
    path.join(process.resourcesPath, 'chromium', 'chrome-win', 'chrome.exe'),
    path.join(process.resourcesPath, 'chromium', 'chrome.exe'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'ms-playwright', 'chromium-1169', 'chrome-win', 'chrome.exe'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'ms-playwright', 'chromium-1161', 'chrome-win', 'chrome.exe'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'ms-playwright', 'chromium-1148', 'chrome-win', 'chrome.exe'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'chromium', 'chrome-win', 'chrome.exe'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'chromium', 'chrome.exe'),
  ]

  for (const candidate of bundledCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  if (process.platform === 'win32') {
    const candidates = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value)).flatMap((base) => ([
      path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(base, 'Chromium', 'Application', 'chrome.exe'),
    ]))

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
  }

  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

async function getPlaywrightChromium() {
  const executablePath = findChromiumExecutable()
  if (!executablePath) {
    throw new Error('No Chrome/Edge executable found for HTML rendering.')
  }

  const bundledRuntimeCandidates = [
    path.join(process.resourcesPath, 'ms-playwright'),
    path.resolve(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'ms-playwright'),
  ]
  const bundledRuntimePath = bundledRuntimeCandidates.find((candidate) => fs.existsSync(candidate))
  if (bundledRuntimePath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledRuntimePath
  }

  const playwright = await import('playwright-core')
  return { chromium: playwright.chromium, executablePath, bundledRuntimePath }
}

export async function renderHtmlToVideoWithChromium(
  htmlPath: string,
  destDir: string,
  baseName: string,
  width: number,
  height: number,
  durationSeconds: number,
): Promise<
  | { success: true; path: string; url: string; thumbnailPath: string; thumbnailUrl: string; width: number; height: number }
  | { success: false; error: string }
> {
  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) {
    return { success: false, error: 'FFmpeg not found for HTML video rendering.' }
  }

  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jianai-chromium-video-'))
  const sourceVideoPath = path.join(recordingDir, `${baseName}.webm`)
  const outputPath = path.join(destDir, `${baseName}.mp4`)
  const thumbnailPath = path.join(destDir, `${baseName}-thumb.png`)
  const fileUrl = pathToFileUrl(htmlPath)
  let browser: any = null
  let context: any = null
  let page: any = null
  let video: { path(): Promise<string> } | null = null

  try {
    const { chromium, executablePath, bundledRuntimePath } = await getPlaywrightChromium()
    logger.info(`[html-render] launching chromium executable=${executablePath}${bundledRuntimePath ? ` runtime=${bundledRuntimePath}` : ''}`)
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion,BackForwardCache',
        '--autoplay-policy=no-user-gesture-required',
      ],
    })

    context = await browser.newContext({
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor: 1,
      recordVideo: {
        dir: recordingDir,
        size: { width, height },
      },
    })
    page = await context.newPage()
    video = page.video()

    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(800)
    await page.waitForTimeout(Math.max(250, Math.round(durationSeconds * 1000)))
    await page.close()
    page = null
    await context.close()
    context = null

    const recordedVideoPath = video ? await video.path() : sourceVideoPath
    if (recordedVideoPath !== sourceVideoPath && fs.existsSync(recordedVideoPath)) {
      fs.copyFileSync(recordedVideoPath, sourceVideoPath)
    }

    if (!fs.existsSync(sourceVideoPath)) {
      return { success: false, error: 'Chromium did not produce a recorded video file.' }
    }

    const ffmpegResult = await runFfmpeg(ffmpegPath, [
      '-i', sourceVideoPath,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ])

    if (!ffmpegResult.success || !fs.existsSync(outputPath)) {
      return { success: false, error: ffmpegResult.error || 'Failed to encode Chromium HTML video asset.' }
    }

    const thumbnailResult = await runFfmpeg(ffmpegPath, [
      '-ss', '0.5',
      '-i', outputPath,
      '-frames:v', '1',
      '-y',
      thumbnailPath,
    ])

    if (!thumbnailResult.success || !fs.existsSync(thumbnailPath)) {
      logger.warn('[html-render] thumbnail extraction failed, falling back to first video frame capture skipped')
    }

    return {
      success: true,
      path: outputPath,
      url: pathToFileUrl(outputPath),
      thumbnailPath,
      thumbnailUrl: pathToFileUrl(thumbnailPath),
      width,
      height,
    }
  } catch (error) {
    logger.error(`[html-render] chromium render failed: ${error}`)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
    if (context) {
      await context.close().catch(() => {})
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
    try {
      fs.rmSync(recordingDir, { recursive: true, force: true })
    } catch {
      // Best effort cleanup only.
    }
  }
}

export async function renderHtmlToImageWithChromium(
  htmlPath: string,
  destDir: string,
  baseName: string,
  width: number,
  height: number,
): Promise<
  | { success: true; path: string; url: string; width: number; height: number }
  | { success: false; error: string }
> {
  const outputPath = path.join(destDir, `${baseName}.png`)
  const fileUrl = pathToFileUrl(htmlPath)
  let browser: any = null
  let context: any = null
  let page: any = null

  try {
    const { chromium, executablePath, bundledRuntimePath } = await getPlaywrightChromium()
    logger.info(`[html-render] launching chromium screenshot executable=${executablePath}${bundledRuntimePath ? ` runtime=${bundledRuntimePath}` : ''}`)
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion,BackForwardCache',
      ],
    })

    context = await browser.newContext({
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor: 1,
    })
    page = await context.newPage()
    await page.goto(fileUrl, { waitUntil: 'load' })
    await page.waitForTimeout(500)
    await page.screenshot({
      path: outputPath,
      type: 'png',
    })

    if (!fs.existsSync(outputPath)) {
      return { success: false, error: 'Chromium did not produce a screenshot file.' }
    }

    return {
      success: true,
      path: outputPath,
      url: pathToFileUrl(outputPath),
      width,
      height,
    }
  } catch (error) {
    logger.error(`[html-render] chromium screenshot failed: ${error}`)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
    if (context) {
      await context.close().catch(() => {})
    }
    if (browser) {
      await browser.close().catch(() => {})
    }
  }
}
