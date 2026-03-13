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

function getOrderedAssets(context: EditingAgentContext) {
  return context.visibleAssets && context.visibleAssets.length > 0 ? context.visibleAssets : context.assets
}

function buildTimelineSnapshot(context: EditingAgentContext): string {
  const sorted = getSortedClips(context)
  const orderedAssets = getOrderedAssets(context)
  const timelineEnd = sorted.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0)
  const payload = {
    currentTime: Number(context.currentTime.toFixed(3)),
    timelineEnd: Number(timelineEnd.toFixed(3)),
    selectedClipIds: [...context.selectedClipIds],
    assetOrderPolicy: 'assets 数组顺序就是当前素材区可见顺序，用户说“第一张图片/第二个视频”时按这个顺序理解。',
    assets: orderedAssets.map((asset, index) => ({
      index: index + 1,
      id: asset.id,
      type: asset.type,
      name: asset.prompt || asset.path.split(/[/\\]/).pop() || asset.type,
      path: asset.path,
      duration: asset.duration ? Number(asset.duration.toFixed(3)) : null,
      resolution: asset.resolution,
      favorite: Boolean(asset.favorite),
      bin: asset.bin || null,
    })),
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
    'actions 只允许以下 type：select_clips, move_clips, delete_clips, duplicate_clips, add_asset_to_timeline, insert_asset_after_clip, insert_asset_before_clip, set_duration, set_speed, set_muted, set_volume, set_transition, trim_clip, split_clip, add_text。',
    '每个 action 必须使用时间线快照里真实存在的 clip id；不要自己编造 clip id。',
    '如果要把素材区资源放到时间线，必须使用 add_asset_to_timeline / insert_asset_after_clip / insert_asset_before_clip，并填写真实 assetId。',
    '如果用户只是询问或总结，actions 返回空数组。',
    '先尽量根据默认规则完成编辑，只有在默认规则仍无法唯一确定时才要求澄清。',
    '默认规则：assets 数组顺序就是当前素材区可见顺序；“第一张图片/第二个视频”按 assets 中同类型素材的顺序理解。',
    '默认规则：如果用户说“素材库/资源区/图片/视频/音频”并伴随“放到/插入/添加到时间线”等措辞，优先解析为 assetId，而不是时间线上的同名 clip。',
    '默认规则：如果用户说“最后/后面/末尾/所有片段之后”且没有指定某个 clip，默认表示时间线末尾，也就是 timelineEnd 之后，用 add_asset_to_timeline。',
    '默认规则：如果用户说“最后一个片段后/选中的片段后/当前片段后”，使用 insert_asset_after_clip。',
    '默认规则：如果用户提到“素材库的某素材”且时间线上存在同名片段，不要反问；仍然优先选择素材区 assetId。',
    '默认规则：如果用户在最近两轮对话里已经给出了素材或位置，本轮只有剩余槽位，也要直接补全执行。',
    'add_text 不需要 clipIds，字段为 text, startTime, duration。',
    'add_asset_to_timeline 字段为 assetId, startTime, trackIndex(可选)。',
    'insert_asset_after_clip / insert_asset_before_clip 字段为 assetId, clipId, trackIndex(可选)。',
    'move_clips 只能二选一使用 deltaSeconds 或 absoluteStartTime。',
    'set_transition 字段必须是 clipIds, edge(in|out), enabled, duration。',
    'trim_clip 字段为 clipIds, trimInSeconds(可选), trimOutSeconds(可选)。',
    'set_volume 取值 0 到 1。',
    'set_speed 和时长必须大于 0。',
    'referencedClipIds 填这次操作涉及到的片段 id；如果没有就返回空数组。',
  ].join('\n')
}

function isLikelyActionRequest(input: string): boolean {
  return /(放到|放入|插入|添加到|加到|拖到|摆到|移到|挪到|后移|前移|删除|删掉|复制|拷贝|切开|分割|切割|裁掉|裁切|静音|音量|倍速|速度|淡入|淡出|标题)/.test(input)
}

function shouldRetryWithDefaults(input: string, result: EditingAgentResult): boolean {
  if (result.actions.length > 0) return false
  if (!isLikelyActionRequest(input)) return false
  return /请明确|请说明|澄清|不清楚|无法确定|具体/.test(result.reply)
}

async function requestLlmResult(
  input: string,
  context: EditingAgentContext,
  config: EditingAgentLlmConfig,
  conversation: ConversationMessage[],
  extraSystemMessages: string[] = [],
): Promise<EditingAgentLlmResult> {
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
        ...extraSystemMessages.map((content) => ({ role: 'system' as const, content })),
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

function extractJsonText(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() || content.trim()

  const firstBraceIndex = candidate.indexOf('{')
  if (firstBraceIndex === -1) {
    return candidate
  }

  let depth = 0
  let inString = false
  let escaping = false

  for (let index = firstBraceIndex; index < candidate.length; index += 1) {
    const char = candidate[index]

    if (inString) {
      if (escaping) {
        escaping = false
        continue
      }
      if (char === '\\') {
        escaping = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return candidate.slice(firstBraceIndex, index + 1).trim()
      }
    }
  }

  return candidate
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
    case 'add_asset_to_timeline': {
      if (typeof action.assetId !== 'string') return null
      const knownAssetIds = new Set(context.assets.map((asset) => asset.id))
      if (!knownAssetIds.has(action.assetId)) return null
      const trackIndex = sanitizeNumber(action.trackIndex)
      const startTime = sanitizeNumber(action.startTime)
      return {
        type: 'add_asset_to_timeline',
        assetId: action.assetId,
        ...(trackIndex !== null ? { trackIndex: Math.max(0, Math.floor(trackIndex)) } : {}),
        ...(startTime !== null ? { startTime: Math.max(0, startTime) } : {}),
      }
    }
    case 'insert_asset_after_clip':
    case 'insert_asset_before_clip': {
      if (typeof action.assetId !== 'string' || typeof action.clipId !== 'string') return null
      const knownAssetIds = new Set(context.assets.map((asset) => asset.id))
      const knownClipIds = new Set(context.clips.map((clip) => clip.id))
      if (!knownAssetIds.has(action.assetId) || !knownClipIds.has(action.clipId)) return null
      const trackIndex = sanitizeNumber(action.trackIndex)
      return {
        type: action.type,
        assetId: action.assetId,
        clipId: action.clipId,
        ...(trackIndex !== null ? { trackIndex: Math.max(0, Math.floor(trackIndex)) } : {}),
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
    case 'trim_clip': {
      const clipIds = sanitizeClipIds(action.clipIds, context)
      const trimInSeconds = sanitizeNumber(action.trimInSeconds)
      const trimOutSeconds = sanitizeNumber(action.trimOutSeconds)
      if (trimInSeconds === null && trimOutSeconds === null) return null
      return {
        type: 'trim_clip',
        clipIds,
        ...(trimInSeconds !== null ? { trimInSeconds: Math.max(0, trimInSeconds) } : {}),
        ...(trimOutSeconds !== null ? { trimOutSeconds: Math.max(0, trimOutSeconds) } : {}),
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
  const initialResult = await requestLlmResult(input, context, config, conversation)
  if (!shouldRetryWithDefaults(input, initialResult)) {
    return initialResult
  }

  return requestLlmResult(input, context, config, conversation, [
    '你刚才倾向于要求澄清，但这条输入更适合直接执行。',
    '现在必须按照默认规则直接给出最合理的一组 actions，不要再次要求澄清。',
    '优先策略：如果出现“素材库/资源区”，优先选 assetId；如果出现“最后/后面/末尾/所有片段之后”，默认放到 timelineEnd；如果出现“第一个/第二个图片或视频”，按 assets 列表的可见顺序理解。',
  ])
}
