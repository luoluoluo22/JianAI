import type { Asset, TimelineClip, Track } from '../../types/project'
import { DEFAULT_COLOR_CORRECTION, DEFAULT_TEXT_STYLE } from '../../types/project'
import { DEFAULT_DISSOLVE_DURATION, formatTime, migrateClip, resolveOverlaps } from './video-editor-utils'

export interface EditingAgentContext {
  assets: Asset[]
  visibleAssets?: Asset[]
  clips: TimelineClip[]
  tracks: Track[]
  selectedClipIds: Set<string>
  currentTime: number
  lastReferencedClipIds?: string[]
}

export interface EditingAgentResult {
  reply: string
  actions: EditingAgentAction[]
  referencedClipIds: string[]
}

export interface EditingAgentApplyResult {
  clips: TimelineClip[]
  selectedClipIds: Set<string>
  summary: string
}

export interface PendingAgentIntent {
  kind: 'place_asset'
  assetId: string | null
  assetLabel: string | null
  positionText: string | null
}

export type EditingAgentAction =
  | { type: 'select_clips'; clipIds: string[] }
  | { type: 'move_clips'; clipIds: string[]; deltaSeconds?: number; absoluteStartTime?: number }
  | { type: 'delete_clips'; clipIds: string[] }
  | { type: 'duplicate_clips'; clipIds: string[]; offsetSeconds: number }
  | { type: 'add_asset_to_timeline'; assetId: string; trackIndex?: number; startTime?: number }
  | { type: 'insert_asset_after_clip'; assetId: string; clipId: string; trackIndex?: number }
  | { type: 'insert_asset_before_clip'; assetId: string; clipId: string; trackIndex?: number }
  | { type: 'set_duration'; clipIds: string[]; duration: number }
  | { type: 'set_speed'; clipIds: string[]; speed: number }
  | { type: 'set_muted'; clipIds: string[]; muted: boolean }
  | { type: 'set_volume'; clipIds: string[]; volume: number }
  | { type: 'set_transition'; clipIds: string[]; edge: 'in' | 'out'; enabled: boolean; duration: number }
  | { type: 'trim_clip'; clipIds: string[]; trimInSeconds?: number; trimOutSeconds?: number }
  | { type: 'split_clip'; clipId: string; time: number }
  | { type: 'add_text'; text: string; startTime: number; duration: number }

type ClipRefResolution = {
  clipIds: string[]
  label: string
}

type PlacementResolution =
  | { kind: 'absolute'; startTime: number; trackIndex?: number; text: string }
  | { kind: 'after'; clipId: string; trackIndex?: number; text: string }
  | { kind: 'before'; clipId: string; trackIndex?: number; text: string }

const EXAMPLE_REPLY =
  '我现在支持这些命令：列出素材、把第一个视频放到5秒、把第二张图片放到最后一个片段后、列出片段、选中第一个片段、把选中的片段往后挪2秒、把第一个片段开头裁掉1秒、在12秒切开第一个片段、给第一个片段加0.5秒淡入、删除最后一个片段、在5秒添加标题 欢迎来到片场。'

function getSortedClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
    return a.id.localeCompare(b.id)
  })
}

function clipLabel(clip: TimelineClip, index: number, tracks: Track[]): string {
  const trackName = tracks[clip.trackIndex]?.name || `T${clip.trackIndex + 1}`
  const name =
    clip.type === 'text'
      ? clip.textStyle?.text || 'Text'
      : clip.importedName || clip.asset?.prompt?.slice(0, 24) || clip.type
  return `${index + 1}. ${name} [${trackName}] ${formatTime(clip.startTime)} - ${(clip.duration).toFixed(1)}s`
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(png|jpg|jpeg|webp|gif|mp4|mov|mkv|mp3|wav|aac)$/i, '')
    .replace(/[“”"'`]/g, '')
    .replace(/\s+/g, '')
}

export function assetDisplayName(asset: Asset): string {
  const prompt = asset.prompt?.trim()
  if (prompt) return prompt
  const fileName = asset.path.split(/[/\\]/).pop()?.trim()
  if (fileName) return fileName
  return asset.type
}

function assetLabel(asset: Asset, index: number): string {
  const duration = asset.duration ? ` ${asset.duration.toFixed(1)}s` : ''
  return `${index + 1}. ${assetDisplayName(asset)} [${asset.type}]${duration}`
}

function getOrderedAssets(context: EditingAgentContext): Asset[] {
  return context.visibleAssets && context.visibleAssets.length > 0 ? context.visibleAssets : context.assets
}

export function summarizeTimelineForAgent(context: EditingAgentContext): string {
  const sorted = getSortedClips(context.clips)
  if (sorted.length === 0) {
    return '当前时间线没有片段。你可以说“把第一个视频放到5秒”或“在5秒添加标题 你好世界”。'
  }

  const selected = sorted.filter((clip) => context.selectedClipIds.has(clip.id))
  const lines = [
    `当前共有 ${sorted.length} 个片段。`,
    selected.length > 0 ? `已选中 ${selected.length} 个片段。` : '当前没有选中片段。',
    '片段列表：',
    ...sorted.slice(0, 12).map((clip, index) => clipLabel(clip, index, context.tracks)),
  ]
  if (sorted.length > 12) {
    lines.push(`还有 ${sorted.length - 12} 个片段未展开。`)
  }
  return lines.join('\n')
}

export function summarizeAssetsForAgent(context: EditingAgentContext): string {
  const ordered = getOrderedAssets(context)
  if (ordered.length === 0) {
    return '当前资源区没有素材。'
  }

  const counts = {
    video: ordered.filter((asset) => asset.type === 'video').length,
    image: ordered.filter((asset) => asset.type === 'image').length,
    audio: ordered.filter((asset) => asset.type === 'audio').length,
  }

  const lines = [
    `当前资源区共有 ${ordered.length} 个素材。视频 ${counts.video} 个，图片 ${counts.image} 个，音频 ${counts.audio} 个。`,
    '素材列表：',
    ...ordered.slice(0, 16).map((asset, index) => assetLabel(asset, index)),
  ]
  if (ordered.length > 16) {
    lines.push(`还有 ${ordered.length - 16} 个素材未展开。`)
  }
  return lines.join('\n')
}

function parseNumberToken(token: string | undefined): number | null {
  if (!token) return null
  const normalized = token.trim()
  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized)
  }

  const map: Record<string, number> = {
    '零': 0,
    '一': 1,
    '二': 2,
    '两': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '七': 7,
    '八': 8,
    '九': 9,
    '十': 10,
  }

  if (normalized === '十') return 10
  if (normalized.length === 2 && normalized.startsWith('十')) {
    return 10 + (map[normalized[1]] ?? 0)
  }
  if (normalized.length === 2 && normalized.endsWith('十')) {
    return (map[normalized[0]] ?? 0) * 10
  }
  if (normalized.length === 3 && normalized[1] === '十') {
    return (map[normalized[0]] ?? 0) * 10 + (map[normalized[2]] ?? 0)
  }
  if (normalized.length === 1 && normalized in map) {
    return map[normalized]
  }
  return null
}

function resolveClipReference(input: string, context: EditingAgentContext): ClipRefResolution | null {
  const sorted = getSortedClips(context.clips)
  if (sorted.length === 0) return null

  if (/所有片段|全部片段/.test(input)) {
    return { clipIds: sorted.map((clip) => clip.id), label: '所有片段' }
  }
  if (/选中(的)?片段/.test(input)) {
    const clipIds = sorted.filter((clip) => context.selectedClipIds.has(clip.id)).map((clip) => clip.id)
    return clipIds.length > 0 ? { clipIds, label: '选中的片段' } : null
  }
  if (/最后(一个)?片段/.test(input)) {
    return { clipIds: [sorted[sorted.length - 1].id], label: '最后一个片段' }
  }
  if (/它们|这些片段|这些/.test(input) || (/它/.test(input) && !/标题/.test(input))) {
    const refs = context.lastReferencedClipIds?.filter((id) => sorted.some((clip) => clip.id === id)) || []
    return refs.length > 0 ? { clipIds: refs, label: '上一次提到的片段' } : null
  }

  const match = input.match(/第\s*([零一二两三四五六七八九十\d]+)\s*(个|段)?片段|片段\s*([零一二两三四五六七八九十\d]+)/)
  const rawIndex = match?.[1] || match?.[3]
  const parsedIndex = parseNumberToken(rawIndex)
  if (parsedIndex && parsedIndex >= 1 && parsedIndex <= sorted.length) {
    return { clipIds: [sorted[parsedIndex - 1].id], label: `第${parsedIndex}个片段` }
  }

  if (/当前片段/.test(input)) {
    const current = sorted.find((clip) => clip.startTime <= context.currentTime && clip.startTime + clip.duration >= context.currentTime)
    return current ? { clipIds: [current.id], label: '当前片段' } : null
  }

  return null
}

function resolveAssetReference(input: string, context: EditingAgentContext): Asset | null {
  const ordered = getOrderedAssets(context)
  if (ordered.length === 0) return null

  const typeFilter = /音频|音乐/.test(input)
    ? 'audio'
    : /图片|图像|照片/.test(input)
      ? 'image'
      : /视频/.test(input)
        ? 'video'
        : null

  const filtered = typeFilter ? ordered.filter((asset) => asset.type === typeFilter) : ordered
  if (filtered.length === 0) return null

  const normalizedInput = normalizeText(input)
  const exact = filtered.find((asset) => {
    const name = normalizeText(assetDisplayName(asset))
    const pathName = normalizeText(asset.path.split(/[/\\]/).pop() || '')
    return normalizedInput === name || normalizedInput === pathName
  })
  if (exact) return exact

  const fuzzy = filtered.find((asset) => {
    const name = normalizeText(assetDisplayName(asset))
    const pathName = normalizeText(asset.path.split(/[/\\]/).pop() || '')
    return normalizedInput.length >= 2 && (name.includes(normalizedInput) || normalizedInput.includes(name) || pathName.includes(normalizedInput))
  })
  if (fuzzy) return fuzzy

  if (/最后(一个)?(素材|视频|图片|音频)?/.test(input)) {
    return filtered[filtered.length - 1]
  }

  const match = input.match(/第\s*([零一二两三四五六七八九十\d]+)\s*(个|段|张)?(素材|视频|图片|音频)?/)
  const parsedIndex = parseNumberToken(match?.[1])
  if (parsedIndex && parsedIndex >= 1 && parsedIndex <= filtered.length) {
    return filtered[parsedIndex - 1]
  }

  if (typeFilter && filtered.length === 1) return filtered[0]
  return null
}

function parseSeconds(input: string): number | null {
  const match = input.match(/(-?\d+(?:\.\d+)?)\s*秒/)
  if (match) return Number(match[1])
  const shortMatch = input.match(/第?\s*(\d+(?:\.\d+)?)\s*s\b/i)
  return shortMatch ? Number(shortMatch[1]) : null
}

function parseDurationInput(input: string): number | null {
  const match = input.match(/(?:时长|长度|持续|改成|裁到|裁剪到)\s*(\d+(?:\.\d+)?)\s*秒/)
  return match ? Number(match[1]) : null
}

function parseSpeed(input: string): number | null {
  const match = input.match(/(?:速度|倍速)(?:调到|改成|设为)?\s*(\d+(?:\.\d+)?)\s*倍/)
  return match ? Number(match[1]) : null
}

function parseVolume(input: string): number | null {
  const match = input.match(/音量(?:调到|改成|设为)?\s*(\d{1,3})\s*%/)
  return match ? Math.max(0, Math.min(100, Number(match[1]))) / 100 : null
}

function parseTrackReference(input: string, context: EditingAgentContext): number | null {
  const match = input.match(/\b([VA])\s*([1-9]\d*)\b/i)
  if (!match) return null
  const kind = match[1].toUpperCase() === 'A' ? 'audio' : 'video'
  const ordinal = Number(match[2])
  const matches = context.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => (track.kind || 'video') === kind)
  return matches[ordinal - 1]?.index ?? null
}

function parseTrimAmounts(input: string): { trimInSeconds?: number; trimOutSeconds?: number } | null {
  const trimInMatch = input.match(/(?:开头|前面|头部|左侧)(?:裁掉|裁去|裁|剪掉|去掉)\s*(\d+(?:\.\d+)?)\s*秒/)
  const trimOutMatch = input.match(/(?:结尾|后面|尾部|右侧)(?:裁掉|裁去|裁|剪掉|去掉)\s*(\d+(?:\.\d+)?)\s*秒/)
  const trimInSeconds = Number(trimInMatch?.[1] || 0)
  const trimOutSeconds = Number(trimOutMatch?.[1] || 0)
  if (trimInSeconds <= 0 && trimOutSeconds <= 0) return null
  return {
    ...(trimInSeconds > 0 ? { trimInSeconds } : {}),
    ...(trimOutSeconds > 0 ? { trimOutSeconds } : {}),
  }
}

function parsePlacement(input: string, context: EditingAgentContext): PlacementResolution | null {
  const trackIndex = parseTrackReference(input, context) ?? undefined
  const clipReference = resolveClipReference(input, context)

  if (clipReference && /(前面|之前|前\b)/.test(input) && !/往前|向前|前移/.test(input)) {
    return { kind: 'before', clipId: clipReference.clipIds[0], trackIndex, text: clipReference.label }
  }
  if (clipReference && /(后面|之后|后\b)/.test(input) && !/往后|向后|后移/.test(input)) {
    return { kind: 'after', clipId: clipReference.clipIds[0], trackIndex, text: clipReference.label }
  }

  const seconds = parseSeconds(input)
  if (seconds !== null) {
    return { kind: 'absolute', startTime: seconds, trackIndex, text: `${seconds}秒` }
  }

  return null
}

function mentionsPlacementIntent(input: string): boolean {
  return /(添加|插入|放到|拖到|放入|加到|摆到|放在)/.test(input) && /(素材|视频|图片|音频|音乐)/.test(input)
}

export function buildPendingAgentIntent(input: string, context: EditingAgentContext): PendingAgentIntent | null {
  if (!mentionsPlacementIntent(input)) return null
  const asset = resolveAssetReference(input, context)
  const placement = parsePlacement(input, context)
  if (asset && placement) return null
  return {
    kind: 'place_asset',
    assetId: asset?.id ?? null,
    assetLabel: asset ? assetDisplayName(asset) : null,
    positionText: placement?.text ?? null,
  }
}

function isLikelyPlacementOnlyInput(input: string, context: EditingAgentContext): boolean {
  return parsePlacement(input, context) !== null && !resolveAssetReference(input, context)
}

function isLikelyAssetOnlyInput(input: string, context: EditingAgentContext): boolean {
  return resolveAssetReference(input, context) !== null && parsePlacement(input, context) === null && !mentionsPlacementIntent(input)
}

export function consumePendingAgentIntent(
  input: string,
  pending: PendingAgentIntent | null,
  context: EditingAgentContext,
): { input: string; pending: PendingAgentIntent | null; consumed: boolean } {
  if (!pending || pending.kind !== 'place_asset') {
    return { input, pending, consumed: false }
  }

  const asset = resolveAssetReference(input, context)
  const placement = parsePlacement(input, context)

  if (pending.assetLabel && isLikelyPlacementOnlyInput(input, context)) {
    return {
      input: `把${pending.assetLabel}放到${input}`,
      pending: null,
      consumed: true,
    }
  }

  if (pending.positionText && asset && isLikelyAssetOnlyInput(input, context)) {
    return {
      input: `把${assetDisplayName(asset)}放到${pending.positionText}`,
      pending: null,
      consumed: true,
    }
  }

  if (!pending.assetLabel && asset && !placement) {
    return {
      input,
      pending: { ...pending, assetId: asset.id, assetLabel: assetDisplayName(asset) },
      consumed: false,
    }
  }

  if (!pending.positionText && placement && !asset) {
    return {
      input,
      pending: { ...pending, positionText: placement.text },
      consumed: false,
    }
  }

  return { input, pending, consumed: false }
}

export function describePendingAgentIntent(intent: PendingAgentIntent): string {
  if (intent.kind === 'place_asset') {
    if (intent.assetLabel && !intent.positionText) {
      return `已记住素材“${intent.assetLabel}”，请再说放到哪里，比如“最后一个片段后”或“5秒”。`
    }
    if (!intent.assetLabel && intent.positionText) {
      return `已记住位置“${intent.positionText}”，请再说要放哪个素材。`
    }
  }
  return '请继续补充你的操作。'
}

export function interpretEditingAgentInput(input: string, context: EditingAgentContext): EditingAgentResult {
  const trimmed = input.trim()
  if (!trimmed) {
    return { reply: '请输入一句剪辑指令。', actions: [], referencedClipIds: [] }
  }

  if (/帮助|能做什么|你会什么/.test(trimmed)) {
    return { reply: EXAMPLE_REPLY, actions: [], referencedClipIds: [] }
  }

  if (/列出片段|看看时间线|总结时间线|总结项目|当前时间线/.test(trimmed)) {
    return { reply: summarizeTimelineForAgent(context), actions: [], referencedClipIds: [] }
  }

  if (/列出素材|看看素材|资源区|素材列表|有哪些素材/.test(trimmed)) {
    return { reply: summarizeAssetsForAgent(context), actions: [], referencedClipIds: [] }
  }

  const textMatch =
    trimmed.match(/在\s*(\d+(?:\.\d+)?)\s*秒(?:钟)?\s*(?:添加|插入)(?:一个)?标题\s+(.+)/)
    || trimmed.match(/(?:添加|插入)(?:一个)?标题\s+(.+)/)
  if (textMatch) {
    const startTime = textMatch[1] ? Number(textMatch[1]) : context.currentTime
    const text = (textMatch[2] || textMatch[1] || '').trim().replace(/^["“]|["”]$/g, '')
    const durationMatch = trimmed.match(/时长\s*(\d+(?:\.\d+)?)\s*秒/)
    const duration = durationMatch ? Number(durationMatch[1]) : 3
    if (!text) {
      return { reply: '标题内容不能为空。例子：在5秒添加标题 欢迎来到片场。', actions: [], referencedClipIds: [] }
    }
    return {
      reply: `准备在 ${startTime.toFixed(1)} 秒添加标题“${text}”。`,
      actions: [{ type: 'add_text', text, startTime, duration }],
      referencedClipIds: [],
    }
  }

  if (mentionsPlacementIntent(trimmed) || /最后一个片段后|选中的片段后|当前片段后|最后一个片段前|选中的片段前|当前片段前/.test(trimmed)) {
    const asset = resolveAssetReference(trimmed, context)
    const placement = parsePlacement(trimmed, context)
    if (asset && placement) {
      if (placement.kind === 'absolute') {
        return {
          reply: `已准备把素材“${assetDisplayName(asset)}”放到时间线 ${placement.startTime.toFixed(1)} 秒处。`,
          actions: [{ type: 'add_asset_to_timeline', assetId: asset.id, startTime: placement.startTime, ...(placement.trackIndex !== undefined ? { trackIndex: placement.trackIndex } : {}) }],
          referencedClipIds: [],
        }
      }
      if (placement.kind === 'after') {
        return {
          reply: `已准备把素材“${assetDisplayName(asset)}”放到目标片段后面。`,
          actions: [{ type: 'insert_asset_after_clip', assetId: asset.id, clipId: placement.clipId, ...(placement.trackIndex !== undefined ? { trackIndex: placement.trackIndex } : {}) }],
          referencedClipIds: [placement.clipId],
        }
      }
      return {
        reply: `已准备把素材“${assetDisplayName(asset)}”放到目标片段前面。`,
        actions: [{ type: 'insert_asset_before_clip', assetId: asset.id, clipId: placement.clipId, ...(placement.trackIndex !== undefined ? { trackIndex: placement.trackIndex } : {}) }],
        referencedClipIds: [placement.clipId],
      }
    }
  }

  const reference = resolveClipReference(trimmed, context)
  if (!reference) {
    return { reply: `我没识别出你要操作哪个片段。\n\n${EXAMPLE_REPLY}`, actions: [], referencedClipIds: [] }
  }

  if (/选中/.test(trimmed)) {
    return {
      reply: `已准备选中${reference.label}。`,
      actions: [{ type: 'select_clips', clipIds: reference.clipIds }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/删除|删掉|移除/.test(trimmed)) {
    return {
      reply: `已准备删除${reference.label}。`,
      actions: [{ type: 'delete_clips', clipIds: reference.clipIds }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/复制|拷贝/.test(trimmed)) {
    const offset = parseSeconds(trimmed) ?? 0.5
    return {
      reply: `已准备复制${reference.label}，并向后偏移 ${offset.toFixed(1)} 秒。`,
      actions: [{ type: 'duplicate_clips', clipIds: reference.clipIds, offsetSeconds: offset }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/切开|分割|切割/.test(trimmed)) {
    const splitTime = trimmed.includes('当前时间') ? context.currentTime : parseSeconds(trimmed)
    if (splitTime === null || reference.clipIds.length === 0) {
      return { reply: '切割命令需要时间点。例子：在12秒切开第一个片段。', actions: [], referencedClipIds: reference.clipIds }
    }
    return {
      reply: `已准备在 ${splitTime.toFixed(1)} 秒切开${reference.label}。`,
      actions: [{ type: 'split_clip', clipId: reference.clipIds[0], time: splitTime }],
      referencedClipIds: reference.clipIds,
    }
  }

  const trimAmounts = parseTrimAmounts(trimmed)
  if (trimAmounts) {
    return {
      reply: `已准备裁切${reference.label}。`,
      actions: [{ type: 'trim_clip', clipIds: reference.clipIds, ...trimAmounts }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/静音/.test(trimmed)) {
    const muted = !/取消静音|解除静音/.test(trimmed)
    return {
      reply: muted ? `已准备将${reference.label}静音。` : `已准备取消${reference.label}静音。`,
      actions: [{ type: 'set_muted', clipIds: reference.clipIds, muted }],
      referencedClipIds: reference.clipIds,
    }
  }

  const volume = parseVolume(trimmed)
  if (volume !== null) {
    return {
      reply: `已准备把${reference.label}音量调到 ${Math.round(volume * 100)}%。`,
      actions: [{ type: 'set_volume', clipIds: reference.clipIds, volume }],
      referencedClipIds: reference.clipIds,
    }
  }

  const speed = parseSpeed(trimmed)
  if (speed !== null) {
    return {
      reply: `已准备把${reference.label}速度改成 ${speed} 倍。`,
      actions: [{ type: 'set_speed', clipIds: reference.clipIds, speed }],
      referencedClipIds: reference.clipIds,
    }
  }

  const duration = parseDurationInput(trimmed)
  if (duration !== null) {
    return {
      reply: `已准备把${reference.label}时长改成 ${duration.toFixed(1)} 秒。`,
      actions: [{ type: 'set_duration', clipIds: reference.clipIds, duration }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/淡入|淡出/.test(trimmed)) {
    const durationSeconds = parseSeconds(trimmed) ?? DEFAULT_DISSOLVE_DURATION
    const enabled = !/取消|移除|去掉/.test(trimmed)
    const edge = /淡出/.test(trimmed) ? 'out' : 'in'
    return {
      reply: enabled
        ? `已准备给${reference.label}添加 ${durationSeconds.toFixed(1)} 秒${edge === 'in' ? '淡入' : '淡出'}。`
        : `已准备移除${reference.label}的${edge === 'in' ? '淡入' : '淡出'}。`,
      actions: [{ type: 'set_transition', clipIds: reference.clipIds, edge, enabled, duration: durationSeconds }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/移到|挪到|放到/.test(trimmed)) {
    const seconds = parseSeconds(trimmed)
    if (seconds === null) {
      return { reply: '绝对移动需要时间点。例子：把第一个片段移到10秒。', actions: [], referencedClipIds: reference.clipIds }
    }
    return {
      reply: `已准备把${reference.label}移到 ${seconds.toFixed(1)} 秒。`,
      actions: [{ type: 'move_clips', clipIds: reference.clipIds, absoluteStartTime: seconds }],
      referencedClipIds: reference.clipIds,
    }
  }

  if (/往后|向后|后移|往前|向前|前移/.test(trimmed)) {
    const seconds = parseSeconds(trimmed)
    if (seconds === null) {
      return { reply: '相对移动需要秒数。例子：把选中的片段往后挪2秒。', actions: [], referencedClipIds: reference.clipIds }
    }
    const sign = /往前|向前|前移/.test(trimmed) ? -1 : 1
    return {
      reply: `已准备将${reference.label}${sign > 0 ? '后移' : '前移'} ${seconds.toFixed(1)} 秒。`,
      actions: [{ type: 'move_clips', clipIds: reference.clipIds, deltaSeconds: sign * seconds }],
      referencedClipIds: reference.clipIds,
    }
  }

  return { reply: `我没完全理解这句指令。\n\n${EXAMPLE_REPLY}`, actions: [], referencedClipIds: reference.clipIds }
}

function createTextClip(text: string, startTime: number, duration: number, tracks: Track[]): TimelineClip {
  const candidateTrackIndexes = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track.kind !== 'audio' && track.type !== 'subtitle')
    .map(({ index }) => index)
  const trackIndex = candidateTrackIndexes.length > 0 ? candidateTrackIndexes[candidateTrackIndexes.length - 1] : 0

  return migrateClip({
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    assetId: null,
    type: 'text',
    startTime,
    duration: Math.max(0.2, duration),
    trimStart: 0,
    trimEnd: 0,
    speed: 1,
    reversed: false,
    muted: true,
    volume: 1,
    trackIndex,
    asset: null,
    flipH: false,
    flipV: false,
    transitionIn: { type: 'none', duration: DEFAULT_DISSOLVE_DURATION },
    transitionOut: { type: 'none', duration: DEFAULT_DISSOLVE_DURATION },
    colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
    opacity: 100,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      text,
    },
  })
}

function buildTimelineClipsFromAsset(
  asset: Asset,
  context: EditingAgentContext,
  startTime: number,
  preferredTrackIndex?: number,
): TimelineClip[] {
  const isAdjustment = asset.type === 'adjustment'
  const isVideoAsset = asset.type === 'video'
  const isAudioAsset = asset.type === 'audio'
  const isImageAsset = asset.type === 'image'

  const targetTrackIndex = preferredTrackIndex ?? (
    isAudioAsset
      ? context.tracks.findIndex((track) => track.kind === 'audio' && !track.locked)
      : context.tracks.findIndex((track) => (track.kind || 'video') === 'video' && !track.locked)
  )
  if (targetTrackIndex < 0) return []

  const targetTrack = context.tracks[targetTrackIndex]
  if (!targetTrack || targetTrack.locked) return []

  const videoPatched = targetTrack.sourcePatched !== false
  if (isAudioAsset && !videoPatched) return []

  const createVideoClip = (isVideoAsset || isImageAsset || isAdjustment) && videoPatched
  const needsAudioClip = isVideoAsset && !isAdjustment
  const audioTrackIndex = needsAudioClip
    ? context.tracks.findIndex((track) => track.kind === 'audio' && !track.locked && track.sourcePatched !== false)
    : -1
  const createAudioClip = needsAudioClip && audioTrackIndex >= 0

  if (!createVideoClip && !createAudioClip && !isAudioAsset) return []

  const clipDuration = asset.duration || (isAdjustment ? 10 : 5)
  const clipStartTime = Math.max(0, startTime)
  const videoClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const audioClipId = `clip-${Date.now()}-a-${Math.random().toString(36).slice(2, 9)}`
  const newClips: TimelineClip[] = []

  if (createVideoClip || isAudioAsset) {
    newClips.push(migrateClip({
      id: isAudioAsset ? audioClipId : videoClipId,
      assetId: asset.id,
      type: isAdjustment ? 'adjustment' : isVideoAsset ? 'video' : isAudioAsset ? 'audio' : 'image',
      startTime: clipStartTime,
      duration: clipDuration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: targetTrackIndex,
      asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
      transitionOut: { type: 'none', duration: isAdjustment ? 0 : 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      opacity: 100,
      ...(createAudioClip ? { linkedClipIds: [audioClipId] } : {}),
    }))
  }

  if (createAudioClip) {
    newClips.push(migrateClip({
      id: audioClipId,
      assetId: asset.id,
      type: 'audio',
      startTime: clipStartTime,
      duration: clipDuration,
      trimStart: 0,
      trimEnd: 0,
      speed: 1,
      reversed: false,
      muted: false,
      volume: 1,
      trackIndex: audioTrackIndex,
      asset,
      flipH: false,
      flipV: false,
      transitionIn: { type: 'none', duration: 0.5 },
      transitionOut: { type: 'none', duration: 0.5 },
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION },
      opacity: 100,
      linkedClipIds: [videoClipId],
    }))
  }

  return newClips
}

function insertAssetRelativeToClip(
  clips: TimelineClip[],
  context: EditingAgentContext,
  assetId: string,
  clipId: string,
  mode: 'before' | 'after',
  preferredTrackIndex?: number,
): TimelineClip[] {
  const asset = context.assets.find((item) => item.id === assetId)
  const targetClip = clips.find((item) => item.id === clipId)
  if (!asset || !targetClip) return []
  const startTime = mode === 'after' ? targetClip.startTime + targetClip.duration : targetClip.startTime
  return buildTimelineClipsFromAsset(asset, context, startTime, preferredTrackIndex ?? targetClip.trackIndex)
}

export function applyEditingAgentActions(
  context: EditingAgentContext,
  actions: EditingAgentAction[],
): EditingAgentApplyResult {
  let clips = [...context.clips]
  let selectedClipIds = new Set(context.selectedClipIds)
  const summaries: string[] = []

  for (const action of actions) {
    switch (action.type) {
      case 'select_clips': {
        selectedClipIds = new Set(action.clipIds)
        summaries.push(`选中了 ${action.clipIds.length} 个片段。`)
        break
      }
      case 'delete_clips': {
        const ids = new Set(action.clipIds)
        clips = clips.filter((clip) => !ids.has(clip.id))
        selectedClipIds = new Set([...selectedClipIds].filter((id) => !ids.has(id)))
        summaries.push(`删除了 ${action.clipIds.length} 个片段。`)
        break
      }
      case 'move_clips': {
        const ids = new Set(action.clipIds)
        const targetClips = clips.filter((clip) => ids.has(clip.id))
        if (targetClips.length === 0) break
        const earliestStart = Math.min(...targetClips.map((clip) => clip.startTime))
        const delta =
          action.deltaSeconds
          ?? ((action.absoluteStartTime ?? earliestStart) - earliestStart)

        clips = clips.map((clip) => {
          if (!ids.has(clip.id)) return clip
          return { ...clip, startTime: Math.max(0, clip.startTime + delta) }
        })
        clips = resolveOverlaps(clips, ids)
        summaries.push(`移动了 ${targetClips.length} 个片段。`)
        break
      }
      case 'duplicate_clips': {
        const sortedTargets = getSortedClips(clips).filter((clip) => action.clipIds.includes(clip.id))
        const duplicates = sortedTargets.map((clip) =>
          migrateClip({
            ...clip,
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            startTime: Math.max(0, clip.startTime + action.offsetSeconds),
            linkedClipIds: clip.linkedClipIds ? [...clip.linkedClipIds] : undefined,
          }))
        const newIds = new Set(duplicates.map((clip) => clip.id))
        clips = resolveOverlaps([...clips, ...duplicates], newIds)
        selectedClipIds = new Set(duplicates.map((clip) => clip.id))
        summaries.push(`复制了 ${duplicates.length} 个片段。`)
        break
      }
      case 'add_asset_to_timeline': {
        const asset = context.assets.find((item) => item.id === action.assetId)
        if (!asset) break
        const newClips = buildTimelineClipsFromAsset(asset, context, action.startTime ?? context.currentTime, action.trackIndex)
        if (newClips.length === 0) {
          summaries.push(`素材“${assetDisplayName(asset)}”没有可用轨道，已跳过。`)
          break
        }
        const newIds = new Set(newClips.map((clip) => clip.id))
        clips = resolveOverlaps([...clips, ...newClips], newIds)
        selectedClipIds = new Set(newClips.map((clip) => clip.id))
        summaries.push(`已把素材“${assetDisplayName(asset)}”放入时间线。`)
        break
      }
      case 'insert_asset_after_clip': {
        const asset = context.assets.find((item) => item.id === action.assetId)
        const newClips = insertAssetRelativeToClip(clips, context, action.assetId, action.clipId, 'after', action.trackIndex)
        if (!asset || newClips.length === 0) {
          summaries.push('未能把素材插入到目标片段后。')
          break
        }
        const newIds = new Set(newClips.map((clip) => clip.id))
        clips = resolveOverlaps([...clips, ...newClips], newIds)
        selectedClipIds = new Set(newClips.map((clip) => clip.id))
        summaries.push(`已把素材“${assetDisplayName(asset)}”插到目标片段后面。`)
        break
      }
      case 'insert_asset_before_clip': {
        const asset = context.assets.find((item) => item.id === action.assetId)
        const newClips = insertAssetRelativeToClip(clips, context, action.assetId, action.clipId, 'before', action.trackIndex)
        if (!asset || newClips.length === 0) {
          summaries.push('未能把素材插入到目标片段前。')
          break
        }
        const newIds = new Set(newClips.map((clip) => clip.id))
        clips = resolveOverlaps([...clips, ...newClips], newIds)
        selectedClipIds = new Set(newClips.map((clip) => clip.id))
        summaries.push(`已把素材“${assetDisplayName(asset)}”插到目标片段前面。`)
        break
      }
      case 'set_duration': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => ids.has(clip.id) ? { ...clip, duration: Math.max(0.2, action.duration) } : clip)
        summaries.push(`更新了 ${action.clipIds.length} 个片段的时长。`)
        break
      }
      case 'set_speed': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => {
          if (!ids.has(clip.id)) return clip
          const safeSpeed = Math.max(0.1, action.speed)
          const sourceSpan = clip.duration * clip.speed
          return {
            ...clip,
            speed: safeSpeed,
            duration: Math.max(0.2, sourceSpan / safeSpeed),
          }
        })
        summaries.push(`更新了 ${action.clipIds.length} 个片段的速度。`)
        break
      }
      case 'set_muted': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => ids.has(clip.id) ? { ...clip, muted: action.muted } : clip)
        summaries.push(action.muted ? '已静音目标片段。' : '已取消静音目标片段。')
        break
      }
      case 'set_volume': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => ids.has(clip.id) ? { ...clip, volume: action.volume, muted: action.volume === 0 ? true : clip.muted } : clip)
        summaries.push(`已将目标片段音量调到 ${Math.round(action.volume * 100)}%。`)
        break
      }
      case 'set_transition': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => {
          if (!ids.has(clip.id)) return clip
          const transition = action.enabled
            ? { type: 'dissolve' as const, duration: Math.max(0.1, action.duration) }
            : { type: 'none' as const, duration: DEFAULT_DISSOLVE_DURATION }
          return action.edge === 'in'
            ? { ...clip, transitionIn: transition }
            : { ...clip, transitionOut: transition }
        })
        summaries.push(action.enabled ? '已更新转场。' : '已移除转场。')
        break
      }
      case 'trim_clip': {
        const ids = new Set(action.clipIds)
        clips = clips.map((clip) => {
          if (!ids.has(clip.id)) return clip
          const trimIn = Math.max(0, action.trimInSeconds ?? 0)
          const trimOut = Math.max(0, action.trimOutSeconds ?? 0)
          if (trimIn <= 0 && trimOut <= 0) return clip
          const maxTrimIn = Math.max(0, clip.duration - trimOut - 0.2)
          const appliedTrimIn = Math.min(trimIn, maxTrimIn)
          const maxTrimOut = Math.max(0, clip.duration - appliedTrimIn - 0.2)
          const appliedTrimOut = Math.min(trimOut, maxTrimOut)
          return {
            ...clip,
            startTime: clip.startTime + appliedTrimIn,
            duration: Math.max(0.2, clip.duration - appliedTrimIn - appliedTrimOut),
            trimStart: clip.trimStart + appliedTrimIn * clip.speed,
            trimEnd: clip.trimEnd + appliedTrimOut * clip.speed,
          }
        })
        summaries.push('已裁切目标片段。')
        break
      }
      case 'split_clip': {
        const clip = clips.find((item) => item.id === action.clipId)
        if (!clip) break
        const splitPoint = action.time - clip.startTime
        if (splitPoint <= 0.05 || splitPoint >= clip.duration - 0.05) {
          summaries.push('切割点不在片段内部，已跳过。')
          break
        }
        const secondHalf: TimelineClip = migrateClip({
          ...clip,
          id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          startTime: clip.startTime + splitPoint,
          duration: clip.duration - splitPoint,
          trimStart: clip.trimStart + splitPoint,
        })
        const firstHalf: TimelineClip = {
          ...clip,
          duration: splitPoint,
          trimEnd: clip.trimEnd + (clip.duration - splitPoint),
        }
        clips = clips.flatMap((item) => {
          if (item.id !== clip.id) return [item]
          return [firstHalf, secondHalf]
        })
        selectedClipIds = new Set([firstHalf.id, secondHalf.id])
        summaries.push('已切开目标片段。')
        break
      }
      case 'add_text': {
        const newClip = createTextClip(action.text, Math.max(0, action.startTime), action.duration, context.tracks)
        clips = resolveOverlaps([...clips, newClip], new Set([newClip.id]))
        selectedClipIds = new Set([newClip.id])
        summaries.push(`已添加标题“${action.text}”。`)
        break
      }
    }
  }

  return {
    clips,
    selectedClipIds,
    summary: summaries.join('\n') || '没有发生任何改动。',
  }
}
