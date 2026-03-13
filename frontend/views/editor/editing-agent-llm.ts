import type { EditingAgentAction, EditingAgentContext, EditingAgentResult } from './editing-agent'

export interface EditingAgentLlmConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export const DEFAULT_EDITING_AGENT_LLM_CONFIG: EditingAgentLlmConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:55555',
  apiKey: 'sk-any',
  model: 'deepseek-chat',
}

export interface EditingAgentLlmResult extends EditingAgentResult {
  rawContent: string
  jsonText: string
}

interface ConversationMessage {
  role: 'user' | 'assistant'
  text: string
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/chat/completions`
  }
  return `${trimmed}/v1/chat/completions`
}

function getSortedClips(context: EditingAgentContext) {
  return [...context.clips].sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex
    return a.id.localeCompare(b.id)
  })
}

function buildTimelineSnapshot(context: EditingAgentContext): string {
  const sorted = getSortedClips(context)
  const payload = {
    currentTime: Number(context.currentTime.toFixed(3)),
    selectedClipIds: [...context.selectedClipIds],
    tracks: context.tracks.map((track, index) => ({
      index,
      id: track.id,
      name: track.name,
      kind: track.kind,
      type: track.type,
      enabled: track.enabled,
    })),
    clips: sorted.map((clip, index) => ({
      index: index + 1,
      id: clip.id,
      type: clip.type,
      trackIndex: clip.trackIndex,
      trackName: context.tracks[clip.trackIndex]?.name || `T${clip.trackIndex + 1}`,
      name: clip.type === 'text'
        ? (clip.textStyle?.text || 'Text')
        : (clip.importedName || clip.asset?.prompt || clip.type),
      startTime: Number(clip.startTime.toFixed(3)),
      duration: Number(clip.duration.toFixed(3)),
      speed: Number(clip.speed.toFixed(3)),
      muted: clip.muted,
      volume: Number((clip.volume ?? 1).toFixed(3)),
      transitionIn: clip.transitionIn,
      transitionOut: clip.transitionOut,
      selected: context.selectedClipIds.has(clip.id),
    })),
    lastReferencedClipIds: context.lastReferencedClipIds ?? [],
  }
  return JSON.stringify(payload, null, 2)
}

function buildSystemPrompt(): string {
  return [
    '你是一个视频时间线编辑代理。',
    '你的任务是把用户中文指令转换成严格 JSON，不能输出 markdown，不能输出解释文字。',
    '你只能返回一个 JSON 对象，格式如下：',
    '{"reply":"给用户看的简短中文回复","actions":[...],"referencedClipIds":["clip-id"]}',
    'actions 只允许以下 type：select_clips, move_clips, delete_clips, duplicate_clips, set_duration, set_speed, set_muted, set_volume, set_transition, split_clip, add_text。',
    '每个 action 必须使用时间线快照里真实存在的 clip id；不要自己编造 clip id。',
    '如果用户只是询问或总结，actions 返回空数组。',
    '如果用户表达不清，reply 里直接要求澄清，actions 返回空数组。',
    'add_text 不需要 clipIds，字段为 text, startTime, duration。',
    'move_clips 只能二选一使用 deltaSeconds 或 absoluteStartTime。',
    'set_transition 字段必须是 clipIds, edge(in|out), enabled, duration。',
    'set_volume 取值 0 到 1。',
    'set_speed 和时长必须大于 0。',
    'referencedClipIds 填这次操作涉及到的片段 id；如果没有就返回空数组。',
  ].join('\n')
}

function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }
  return content.trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeClipIds(value: unknown, context: EditingAgentContext): string[] {
  if (!Array.isArray(value)) return []
  const knownIds = new Set(context.clips.map((clip) => clip.id))
  return value.filter((item): item is string => typeof item === 'string' && knownIds.has(item))
}

function sanitizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sanitizeAction(action: unknown, context: EditingAgentContext): EditingAgentAction | null {
  if (!isRecord(action) || typeof action.type !== 'string') {
    return null
  }

  switch (action.type) {
    case 'select_clips': {
      return { type: 'select_clips', clipIds: sanitizeClipIds(action.clipIds, context) }
    }
    case 'move_clips': {
      const clipIds = sanitizeClipIds(action.clipIds, context)
      const deltaSeconds = sanitizeNumber(action.deltaSeconds)
      const absoluteStartTime = sanitizeNumber(action.absoluteStartTime)
      if (deltaSeconds === null && absoluteStartTime === null) return null
      return {
        type: 'move_clips',
        clipIds,
        ...(deltaSeconds !== null ? { deltaSeconds } : {}),
        ...(absoluteStartTime !== null ? { absoluteStartTime: Math.max(0, absoluteStartTime) } : {}),
      }
    }
    case 'delete_clips': {
      return { type: 'delete_clips', clipIds: sanitizeClipIds(action.clipIds, context) }
    }
    case 'duplicate_clips': {
      const offsetSeconds = sanitizeNumber(action.offsetSeconds)
      if (offsetSeconds === null) return null
      return {
        type: 'duplicate_clips',
        clipIds: sanitizeClipIds(action.clipIds, context),
        offsetSeconds,
      }
    }
    case 'set_duration': {
      const duration = sanitizeNumber(action.duration)
      if (duration === null) return null
      return {
        type: 'set_duration',
        clipIds: sanitizeClipIds(action.clipIds, context),
        duration: Math.max(0.1, duration),
      }
    }
    case 'set_speed': {
      const speed = sanitizeNumber(action.speed)
      if (speed === null) return null
      return {
        type: 'set_speed',
        clipIds: sanitizeClipIds(action.clipIds, context),
        speed: Math.max(0.1, speed),
      }
    }
    case 'set_muted': {
      if (typeof action.muted !== 'boolean') return null
      return {
        type: 'set_muted',
        clipIds: sanitizeClipIds(action.clipIds, context),
        muted: action.muted,
      }
    }
    case 'set_volume': {
      const volume = sanitizeNumber(action.volume)
      if (volume === null) return null
      return {
        type: 'set_volume',
        clipIds: sanitizeClipIds(action.clipIds, context),
        volume: Math.max(0, Math.min(1, volume)),
      }
    }
    case 'set_transition': {
      const duration = sanitizeNumber(action.duration)
      if (duration === null || (action.edge !== 'in' && action.edge !== 'out') || typeof action.enabled !== 'boolean') {
        return null
      }
      return {
        type: 'set_transition',
        clipIds: sanitizeClipIds(action.clipIds, context),
        edge: action.edge,
        enabled: action.enabled,
        duration: Math.max(0.1, duration),
      }
    }
    case 'split_clip': {
      if (typeof action.clipId !== 'string') return null
      const time = sanitizeNumber(action.time)
      const knownIds = new Set(context.clips.map((clip) => clip.id))
      if (time === null || !knownIds.has(action.clipId)) return null
      return {
        type: 'split_clip',
        clipId: action.clipId,
        time: Math.max(0, time),
      }
    }
    case 'add_text': {
      const startTime = sanitizeNumber(action.startTime)
      const duration = sanitizeNumber(action.duration)
      if (typeof action.text !== 'string' || startTime === null || duration === null) return null
      return {
        type: 'add_text',
        text: action.text.trim(),
        startTime: Math.max(0, startTime),
        duration: Math.max(0.1, duration),
      }
    }
    default:
      return null
  }
}

function sanitizeAgentResult(payload: unknown, context: EditingAgentContext): EditingAgentResult {
  if (!isRecord(payload)) {
    return { reply: '模型返回了无效结果。', actions: [], referencedClipIds: [] }
  }

  const actions = Array.isArray(payload.actions)
    ? payload.actions
      .map((action) => sanitizeAction(action, context))
      .filter((action): action is EditingAgentAction => action !== null)
      .filter((action) => {
        if ('clipIds' in action) {
          return action.clipIds.length > 0
        }
        if (action.type === 'split_clip') {
          return Boolean(action.clipId)
        }
        return true
      })
    : []

  return {
    reply: typeof payload.reply === 'string' && payload.reply.trim()
      ? payload.reply.trim()
      : (actions.length > 0 ? '已根据模型建议准备修改时间线。' : '模型没有返回可执行操作。'),
    actions,
    referencedClipIds: sanitizeClipIds(payload.referencedClipIds, context),
  }
}

export async function interpretEditingAgentWithLlm(
  input: string,
  context: EditingAgentContext,
  config: EditingAgentLlmConfig,
  conversation: ConversationMessage[],
): Promise<EditingAgentLlmResult> {
  if (!config.enabled) {
    throw new Error('LLM agent disabled')
  }

  const response = await fetch(buildChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        {
          role: 'system',
          content: `当前时间线快照如下，请严格基于这些 clip id 和字段做决策：\n${buildTimelineSnapshot(context)}`,
        },
        ...conversation.slice(-6).map((message) => ({
          role: message.role,
          content: message.text,
        })),
        { role: 'user', content: input },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`LLM request failed with status ${response.status}`)
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('LLM response did not include message content')
  }

  const jsonText = extractJsonText(content)
  const parsed = JSON.parse(jsonText) as unknown
  return {
    ...sanitizeAgentResult(parsed, context),
    rawContent: content,
    jsonText,
  }
}
