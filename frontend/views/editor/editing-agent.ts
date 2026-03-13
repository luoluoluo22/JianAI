import type { TimelineClip, Track } from '../../types/project'
import { DEFAULT_COLOR_CORRECTION, DEFAULT_TEXT_STYLE } from '../../types/project'
import { DEFAULT_DISSOLVE_DURATION, formatTime, migrateClip, resolveOverlaps } from './video-editor-utils'

export interface EditingAgentContext {
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

export type EditingAgentAction =
  | { type: 'select_clips'; clipIds: string[] }
  | { type: 'move_clips'; clipIds: string[]; deltaSeconds?: number; absoluteStartTime?: number }
  | { type: 'delete_clips'; clipIds: string[] }
  | { type: 'duplicate_clips'; clipIds: string[]; offsetSeconds: number }
  | { type: 'set_duration'; clipIds: string[]; duration: number }
  | { type: 'set_speed'; clipIds: string[]; speed: number }
  | { type: 'set_muted'; clipIds: string[]; muted: boolean }
  | { type: 'set_volume'; clipIds: string[]; volume: number }
  | { type: 'set_transition'; clipIds: string[]; edge: 'in' | 'out'; enabled: boolean; duration: number }
  | { type: 'split_clip'; clipId: string; time: number }
  | { type: 'add_text'; text: string; startTime: number; duration: number }

type ClipRefResolution = {
  clipIds: string[]
  label: string
}

const EXAMPLE_REPLY =
  '我现在支持这些命令：列出片段、选中第一个片段、把选中的片段往后挪2秒、把第二个片段时长改成3秒、把第一个片段速度调到2倍、给第一个片段加0.5秒淡入、删除最后一个片段、在5秒添加标题 欢迎来到片场。'

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

export function summarizeTimelineForAgent(context: EditingAgentContext): string {
  const sorted = getSortedClips(context.clips)
  if (sorted.length === 0) {
    return '当前时间线没有片段。你可以说“在5秒添加标题 你好世界”。'
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

function parseSeconds(input: string): number | null {
  const match = input.match(/(-?\d+(?:\.\d+)?)\s*秒/)
  return match ? Number(match[1]) : null
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
