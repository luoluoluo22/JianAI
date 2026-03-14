import type { TimelineClip } from '../../types/project'
import { logger } from '../../lib/logger'
import type { EditingAgentAction, EditingAgentResult } from './editing-agent'

export interface EditingAgentDebugEntry {
  timestamp: string
  phase: 'request' | 'llm_result' | 'fallback_result' | 'apply_result' | 'error' | 'ui_context_menu'
  userText: string
  provider: 'llm' | 'rule'
  details: Record<string, unknown>
}

function clipSnapshot(clip: TimelineClip) {
  return {
    id: clip.id,
    startTime: Number(clip.startTime.toFixed(3)),
    duration: Number(clip.duration.toFixed(3)),
    speed: Number(clip.speed.toFixed(3)),
    trackIndex: clip.trackIndex,
    muted: clip.muted,
    volume: Number((clip.volume ?? 1).toFixed(3)),
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
  }
}

function summarizeAction(action: EditingAgentAction): string {
  if (action.type === 'import_image_asset') {
    return JSON.stringify({
      ...action,
      source: action.source.startsWith('data:image/')
        ? `[data-uri length=${action.source.length}]`
        : action.source,
    })
  }
  if (action.type !== 'create_html_asset') {
    return JSON.stringify(action)
  }
  return JSON.stringify({
    ...action,
    html: `[html length=${action.html.length}]`,
  })
}

export function summarizeActions(actions: EditingAgentAction[]): string[] {
  return actions.map(summarizeAction)
}

export function diffClips(before: TimelineClip[], after: TimelineClip[]): string[] {
  const beforeMap = new Map(before.map((clip) => [clip.id, clip]))
  const afterMap = new Map(after.map((clip) => [clip.id, clip]))
  const ids = new Set([...beforeMap.keys(), ...afterMap.keys()])
  const diffs: string[] = []

  for (const id of ids) {
    const prev = beforeMap.get(id)
    const next = afterMap.get(id)
    if (!prev && next) {
      diffs.push(`added ${id} start=${next.startTime.toFixed(3)} duration=${next.duration.toFixed(3)}`)
      continue
    }
    if (prev && !next) {
      diffs.push(`removed ${id}`)
      continue
    }
    if (!prev || !next) continue

    if (prev.startTime !== next.startTime) diffs.push(`${id} startTime ${prev.startTime.toFixed(3)} -> ${next.startTime.toFixed(3)}`)
    if (prev.duration !== next.duration) diffs.push(`${id} duration ${prev.duration.toFixed(3)} -> ${next.duration.toFixed(3)}`)
    if (prev.speed !== next.speed) diffs.push(`${id} speed ${prev.speed.toFixed(3)} -> ${next.speed.toFixed(3)}`)
    if (prev.trackIndex !== next.trackIndex) diffs.push(`${id} trackIndex ${prev.trackIndex} -> ${next.trackIndex}`)
    if (prev.muted !== next.muted) diffs.push(`${id} muted ${String(prev.muted)} -> ${String(next.muted)}`)
    if ((prev.volume ?? 1) !== (next.volume ?? 1)) diffs.push(`${id} volume ${(prev.volume ?? 1).toFixed(3)} -> ${(next.volume ?? 1).toFixed(3)}`)

    const prevIn = JSON.stringify(prev.transitionIn)
    const nextIn = JSON.stringify(next.transitionIn)
    if (prevIn !== nextIn) diffs.push(`${id} transitionIn ${prevIn} -> ${nextIn}`)

    const prevOut = JSON.stringify(prev.transitionOut)
    const nextOut = JSON.stringify(next.transitionOut)
    if (prevOut !== nextOut) diffs.push(`${id} transitionOut ${prevOut} -> ${nextOut}`)
  }

  return diffs
}

export async function persistEditingAgentDebugEntry(entry: EditingAgentDebugEntry): Promise<void> {
  const line = JSON.stringify(entry)
  logger.debug(`[EditingAgentDebug] ${line}`)
  await window.electronAPI?.appendAgentDebugLog?.(line)
}

export function buildRequestDebugEntry(
  userText: string,
  provider: 'llm' | 'rule',
  clips: TimelineClip[],
  extraDetails?: Record<string, unknown>,
): EditingAgentDebugEntry {
  return {
    timestamp: new Date().toISOString(),
    phase: 'request',
    userText,
    provider,
    details: {
      clipCount: clips.length,
      clips: clips.slice(0, 12).map(clipSnapshot),
      ...extraDetails,
    },
  }
}

export function buildLlmMessagePreview(
  messages: Array<{ role: string; content: string }>,
): Array<{ role: string; contentPreview: string; contentLength: number }> {
  return messages.map((message) => ({
    role: message.role,
    contentPreview: message.content.slice(0, 400),
    contentLength: message.content.length,
  }))
}

export function buildInterpretationDebugEntry(
  phase: 'llm_result' | 'fallback_result',
  userText: string,
  provider: 'llm' | 'rule',
  interpretation: EditingAgentResult,
  extraDetails?: Record<string, unknown>,
): EditingAgentDebugEntry {
  return {
    timestamp: new Date().toISOString(),
    phase,
    userText,
    provider,
    details: {
      reply: interpretation.reply,
      actions: summarizeActions(interpretation.actions),
      referencedClipIds: interpretation.referencedClipIds,
      ...extraDetails,
    },
  }
}

export function buildApplyDebugEntry(
  userText: string,
  provider: 'llm' | 'rule',
  beforeClips: TimelineClip[],
  afterClips: TimelineClip[],
  interpretation: EditingAgentResult,
  applySummary: string,
): EditingAgentDebugEntry {
  return {
    timestamp: new Date().toISOString(),
    phase: 'apply_result',
    userText,
    provider,
    details: {
      reply: interpretation.reply,
      actions: summarizeActions(interpretation.actions),
      applySummary,
      diffs: diffClips(beforeClips, afterClips),
      beforeClipCount: beforeClips.length,
      afterClipCount: afterClips.length,
    },
  }
}

export function buildErrorDebugEntry(
  userText: string,
  provider: 'llm' | 'rule',
  error: unknown,
): EditingAgentDebugEntry {
  return {
    timestamp: new Date().toISOString(),
    phase: 'error',
    userText,
    provider,
    details: {
      error: error instanceof Error ? error.message : String(error),
    },
  }
}

export function buildUiContextMenuDebugEntry(
  userText: string,
  details: Record<string, unknown>,
): EditingAgentDebugEntry {
  return {
    timestamp: new Date().toISOString(),
    phase: 'ui_context_menu',
    userText,
    provider: 'rule',
    details,
  }
}
