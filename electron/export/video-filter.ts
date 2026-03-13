import fs from 'fs'
import path from 'path'
import type { FlatSegment } from './timeline'

export interface ExportSubtitle {
  text: string; startTime: number; endTime: number;
  style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean };
}

export interface ExportTextOverlay {
  text: string
  startTime: number
  endTime: number
  style: {
    fontSize: number
    fontFamily: string
    fontWeight: string
    fontStyle?: string
    color: string
    backgroundColor: string
    textAlign?: 'left' | 'center' | 'right'
    positionX: number
    positionY: number
    strokeColor?: string
    strokeWidth?: number
    shadowColor?: string
    shadowOffsetX?: number
    shadowOffsetY?: number
  }
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
    .replace(/\n/g, '\\n')
}

function rgbComponentToHex(value: string): string {
  const numeric = Math.max(0, Math.min(255, Math.round(Number(value))))
  return numeric.toString(16).padStart(2, '0')
}

function parseCssColor(color: string): string | null {
  const trimmed = color.trim()
  const rgbaMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (!rgbaMatch) return null

  const [, r, g, b, alphaRaw] = rgbaMatch
  const hex = `${rgbComponentToHex(r)}${rgbComponentToHex(g)}${rgbComponentToHex(b)}`
  if (alphaRaw === undefined) {
    return `0x${hex}`
  }
  const alpha = Math.max(0, Math.min(1, Number(alphaRaw)))
  return `0x${hex}@${alpha.toFixed(2)}`
}

function normalizeColor(color: string, fallback: string): string {
  const trimmed = color.trim()
  if (!trimmed || trimmed === 'transparent') return fallback
  if (trimmed.startsWith('#')) return trimmed.replace('#', '0x')
  const parsedCss = parseCssColor(trimmed)
  if (parsedCss) return parsedCss
  return trimmed
}

function normalizeBoxColor(color: string): string | null {
  const trimmed = color.trim()
  if (!trimmed || trimmed === 'transparent') return null
  if (trimmed.startsWith('#')) {
    const hex = trimmed.replace('#', '')
    if (hex.length > 6) {
      const base = hex.slice(0, 6)
      const alpha = (parseInt(hex.slice(6), 16) / 255).toFixed(2)
      return `0x${base}@${alpha}`
    }
    return `0x${hex}@0.6`
  }
  const parsedCss = parseCssColor(trimmed)
  if (parsedCss) return parsedCss
  return trimmed
}

function escapeDrawtextValue(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
}

function resolveDrawtextFontFile(fontFamily?: string, fontWeight?: string): string | null {
  if (process.platform !== 'win32') return null

  const family = (fontFamily || '').toLowerCase()
  const isBold = ['bold', '600', '700', '800', '900'].includes((fontWeight || '').toLowerCase())
  const candidates: string[] = []

  if (family.includes('yahei') || family.includes('微软雅黑') || family.includes('microsoft')) {
    candidates.push(isBold ? 'msyhbd.ttc' : 'msyh.ttc')
  }
  if (family.includes('heiti') || family.includes('黑体')) {
    candidates.push('simhei.ttf')
  }
  if (family.includes('song') || family.includes('宋体')) {
    candidates.push('simsun.ttc')
  }

  candidates.push(isBold ? 'msyhbd.ttc' : 'msyh.ttc', 'simhei.ttf', 'simsun.ttc')

  for (const candidate of candidates) {
    const fullPath = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', candidate)
    if (fs.existsSync(fullPath)) {
      return fullPath
    }
  }
  return null
}

/**
 * Build the ffmpeg filter_complex script and input arguments for the video-only pass.
 * Pure string building — zero I/O.
 */
export function buildVideoFilterGraph(
  segments: FlatSegment[],
  opts: {
    width: number; height: number; fps: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: ExportSubtitle[];
    textOverlays?: ExportTextOverlay[];
  },
): { inputs: string[]; filterScript: string } {
  const { width, height, fps, letterbox, subtitles, textOverlays } = opts
  const inputs: string[] = []
  const filterParts: string[] = []
  let idx = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    if (seg.type === 'gap') {
      // Gap: generate black frames at target fps (synthetic input)
      inputs.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seg.duration.toFixed(6)}`)
      filterParts.push(`[${idx}:v]setsar=1[v${i}]`)
      idx++
    } else if (seg.type === 'image') {
      // Image: loop for exact duration, use target fps for frame generation
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', seg.duration.toFixed(6), '-i', seg.filePath)
      let chain = `[${idx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=black,setsar=1`
      if (seg.flipH) chain += ',hflip'
      if (seg.flipV) chain += ',vflip'
      chain += `[v${i}]`
      filterParts.push(chain)
      idx++
    } else {
      // Video: trim -> speed -> scale, NO per-segment fps conversion
      // (fps is applied ONCE after concat to avoid per-segment duration quantization)
      const trimEnd = seg.trimStart + seg.duration * seg.speed
      inputs.push('-i', seg.filePath)
      let chain = `[${idx}:v]trim=start=${seg.trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)},setpts=PTS-STARTPTS`
      if (seg.speed !== 1) chain += `,setpts=PTS/${seg.speed.toFixed(6)}`
      if (seg.reversed) chain += ',reverse'
      chain += `,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=black,setsar=1`
      if (seg.flipH) chain += ',hflip'
      if (seg.flipV) chain += ',vflip'
      chain += `[v${i}]`
      filterParts.push(chain)
      idx++
    }
  }

  const concatInputs = segments.map((_, i) => `[v${i}]`).join('')

  // Concat all segments, then apply fps ONCE to the entire output.
  // This is how real NLEs work: frame rate conversion happens globally,
  // not per-clip, so per-segment duration quantization doesn't accumulate.
  let lastLabel = 'fpsout'
  filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=0[concatraw]`)
  filterParts.push(`[concatraw]fps=${fps}[${lastLabel}]`)

  // Letterbox overlay (drawbox)
  if (letterbox) {
    const containerRatio = width / height
    const targetRatio = letterbox.ratio
    const hexColor = letterbox.color.replace('#', '')
    const alphaHex = Math.round(letterbox.opacity * 255).toString(16).padStart(2, '0')
    const colorStr = `0x${hexColor}${alphaHex}`
    const nextLabel = 'lbout'

    if (targetRatio >= containerRatio) {
      // Letterbox: bars on top and bottom
      const visibleH = Math.round(width / targetRatio)
      const barH = Math.round((height - visibleH) / 2)
      if (barH > 0) {
        filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=iw:h=${barH}:c=${colorStr}:t=fill,drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:c=${colorStr}:t=fill[${nextLabel}]`)
        lastLabel = nextLabel
      }
    } else {
      // Pillarbox: bars on left and right
      const visibleW = Math.round(height * targetRatio)
      const barW = Math.round((width - visibleW) / 2)
      if (barW > 0) {
        filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill,drawbox=x=iw-${barW}:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill[${nextLabel}]`)
        lastLabel = nextLabel
      }
    }
  }

  // Subtitle burn-in (drawtext)
  if (subtitles && subtitles.length > 0) {
    for (let si = 0; si < subtitles.length; si++) {
      const sub = subtitles[si]
      const nextLabel = `sub${si}`
      // Escape text for ffmpeg drawtext: replace special chars
      const escapedText = escapeDrawtextText(sub.text)

      const fontSize = Math.round(sub.style.fontSize * (height / 1080)) // scale relative to export res
      const fontColor = normalizeColor(sub.style.color, '0xFFFFFF')
      const fontFile = resolveDrawtextFontFile(sub.style.fontFamily, sub.style.fontWeight)

      // Y position based on style.position
      let yExpr: string
      if (sub.style.position === 'top') {
        yExpr = '20'
      } else if (sub.style.position === 'center') {
        yExpr = '(h-text_h)/2'
      } else {
        yExpr = 'h-text_h-30'
      }

      // Background box
      let boxPart = ''
      const boxColor = normalizeBoxColor(sub.style.backgroundColor)
      if (boxColor) {
        boxPart = `:box=1:boxcolor=${boxColor}:boxborderw=8`
      }

      const dtFilter = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}${fontFile ? `:fontfile='${escapeDrawtextValue(fontFile)}'` : ''}:x=(w-text_w)/2:y=${yExpr}${boxPart}:enable='between(t\\,${sub.startTime.toFixed(3)}\\,${sub.endTime.toFixed(3)})'`

      filterParts.push(`[${lastLabel}]${dtFilter}[${nextLabel}]`)
      lastLabel = nextLabel
    }
  }

  if (textOverlays && textOverlays.length > 0) {
    for (let ti = 0; ti < textOverlays.length; ti++) {
      const overlay = textOverlays[ti]
      const nextLabel = `txt${ti}`
      const escapedText = escapeDrawtextText(overlay.text)
      const fontSize = Math.max(12, Math.round(overlay.style.fontSize * (height / 1080)))
      const fontColor = normalizeColor(overlay.style.color, '0xFFFFFF')
      const fontFile = resolveDrawtextFontFile(overlay.style.fontFamily, overlay.style.fontWeight)
      const boxColor = normalizeBoxColor(overlay.style.backgroundColor)
      const strokeColor = overlay.style.strokeColor && overlay.style.strokeColor !== 'transparent'
        ? normalizeColor(overlay.style.strokeColor, '0x000000')
        : null
      const shadowColor = overlay.style.shadowColor && overlay.style.shadowColor !== 'transparent'
        ? normalizeColor(overlay.style.shadowColor, 'black')
        : null
      const anchorX = Math.max(0, Math.min(100, overlay.style.positionX))
      const anchorY = Math.max(0, Math.min(100, overlay.style.positionY))
      const xExpr = overlay.style.textAlign === 'left'
        ? `(w*${(anchorX / 100).toFixed(4)})`
        : overlay.style.textAlign === 'right'
          ? `(w*${(anchorX / 100).toFixed(4)}-text_w)`
          : `(w*${(anchorX / 100).toFixed(4)}-text_w/2)`
      const yExpr = `(h*${(anchorY / 100).toFixed(4)}-text_h/2)`

      let drawtext = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}${fontFile ? `:fontfile='${escapeDrawtextValue(fontFile)}'` : ''}:x=${xExpr}:y=${yExpr}`
      if (boxColor) drawtext += `:box=1:boxcolor=${boxColor}:boxborderw=${Math.max(0, Math.round((overlay.style.strokeWidth ?? 0) + 8))}`
      if (strokeColor && (overlay.style.strokeWidth ?? 0) > 0) {
        drawtext += `:borderw=${Math.max(1, Math.round(overlay.style.strokeWidth ?? 1))}:bordercolor=${strokeColor}`
      }
      if (shadowColor) {
        drawtext += `:shadowcolor=${shadowColor}:shadowx=${Math.round(overlay.style.shadowOffsetX ?? 0)}:shadowy=${Math.round(overlay.style.shadowOffsetY ?? 0)}`
      }
      drawtext += `:enable='between(t\\,${overlay.startTime.toFixed(3)}\\,${overlay.endTime.toFixed(3)})'`

      filterParts.push(`[${lastLabel}]${drawtext}[${nextLabel}]`)
      lastLabel = nextLabel
    }
  }

  // Rename final label to outv
  if (lastLabel !== 'outv') {
    filterParts.push(`[${lastLabel}]null[outv]`)
  }

  return { inputs, filterScript: filterParts.join(';\n') }
}
