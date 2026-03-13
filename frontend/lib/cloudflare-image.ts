import { readCloudflareImageSettings } from './cloudflare-image-settings'
import { logger } from './logger'

export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = '@cf/leonardo/lucid-origin'
const DEFAULT_GUIDANCE = 4.5

interface CloudflareImageRequest {
  prompt: string
  model?: string
  width: number
  height: number
  numSteps: number
  index: number
  signal?: AbortSignal
}

export async function generateImageWithCloudflare({
  prompt,
  model,
  width,
  height,
  numSteps,
  index,
  signal,
}: CloudflareImageRequest): Promise<ArrayBuffer> {
  const { accountId, apiToken } = readCloudflareImageSettings()

  if (!accountId.trim() || !apiToken.trim()) {
    throw new Error('Cloudflare 图片生成凭证未配置。')
  }

  const resolvedModel = model || DEFAULT_CLOUDFLARE_IMAGE_MODEL
  logger.info(`[CloudflareImage] request via ipc model=${resolvedModel} size=${width}x${height} steps=${numSteps} promptLength=${prompt.length}`)
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await window.electronAPI.generateCloudflareImage({
    accountId,
    apiToken,
    model: resolvedModel,
    prompt,
    width,
    height,
    steps: numSteps,
    guidance: DEFAULT_GUIDANCE,
    seed: Date.now() + index,
  })

  if (!result.success) {
    logger.error(`[CloudflareImage] ipc failed model=${resolvedModel} detail=${result.error}`)
    throw new Error(result.error)
  }

  logger.info(`[CloudflareImage] ipc response ok model=${resolvedModel}`)
  return result.data
}
